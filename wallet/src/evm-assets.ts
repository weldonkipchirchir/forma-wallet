import { getAddress } from 'ethers';
import { evmNetworks, type EvmNetworkId } from './evm-networks';
import { savedTokens, type Token } from './token-data';
import { parseJournal, type TokenSubmission } from './token-journal';

export const evmTokenKey = (network: EvmNetworkId, owner: string) => `forma.evm.tokens.v1:${evmNetworks[network].chainId}:${getAddress(owner).toLowerCase()}`;
export const evmJournalKey = (network: EvmNetworkId, owner: string) => `forma.evm.submissions.v1:${evmNetworks[network].chainId}:${getAddress(owner).toLowerCase()}`;
type ReadStore = Pick<Storage, 'getItem'>;
export const EVM_TOKEN_LIMIT = 250;
export const EVM_TOKEN_PAGE_SIZE = 20;
export const EVM_BALANCE_CONCURRENCY = 3;
export async function loadEvmPageBalances(tokens: Token[], read: (token: Token) => Promise<bigint>, current: () => boolean, update: (token: Token, balance: bigint | undefined) => void) {
  const page = tokens.slice(0, EVM_TOKEN_PAGE_SIZE); let next = 0;
  await Promise.all(Array.from({ length: Math.min(EVM_BALANCE_CONCURRENCY, page.length) }, async () => {
    while (next < page.length && current()) {
      const token = page[next++]; let value: bigint | undefined;
      try { value = await read(token); } catch { value = undefined; }
      if (!current()) return;
      update(token, value);
    }
  }));
}
export function parseEvmTokens(value: unknown): Token[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, Token>();
  for (const entry of value.slice(0, EVM_TOKEN_LIMIT)) {
    const token = savedTokens([entry])[0];
    if (token) unique.set(token.address, token);
  }
  return [...unique.values()];
}
export function evmTokenPage(tokens: Token[], search = '', page = 0) {
  const query = search.trim().slice(0, 100).toLowerCase();
  const matching = tokens.filter(token => [token.name, token.symbol, token.address].some(value => value.toLowerCase().includes(query)));
  const pages = Math.max(1, Math.ceil(matching.length / EVM_TOKEN_PAGE_SIZE));
  const selected = Math.max(0, Math.min(pages - 1, Number.isSafeInteger(page) ? page : 0));
  return { tokens: matching.slice(selected * EVM_TOKEN_PAGE_SIZE, (selected + 1) * EVM_TOKEN_PAGE_SIZE), total: matching.length, page: selected, pages };
}
export function readEvmTokens(store: ReadStore, network: EvmNetworkId, owner: string): Token[] {
  try {
    const raw = store.getItem(evmTokenKey(network, owner)) || '[]';
    return raw.length > 500_000 ? [] : parseEvmTokens(JSON.parse(raw));
  } catch { return []; }
}
export function readEvmJournal(store: ReadStore, network: EvmNetworkId, owner: string): TokenSubmission[] {
  const raw = store.getItem(evmJournalKey(network, owner));
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('Submission history is damaged. Sending is blocked until it can be recovered.'); }
  const rows = parseJournal(data);
  if (!Array.isArray(data) || data.length > 200 || rows.length !== data.length) throw new Error('Submission history is invalid. Sending is blocked.');
  return rows;
}
export function retainEvmSubmission(rows: TokenSubmission[], next: TokenSubmission) {
  const merged = [next, ...rows.filter(row => row.hash !== next.hash)];
  const unresolved = merged.filter(row => row.status === 'pending' || row.status === 'unknown');
  if (unresolved.length > 200) throw new Error('Too many unresolved submissions. Sending is blocked.');
  return [...unresolved, ...merged.filter(row => row.status === 'confirmed' || row.status === 'failed')].slice(0, 200);
}
export function requireResolvedEvm(rows: TokenSubmission[]) {
  if (rows.some(row => row.status === 'unknown' || row.status === 'pending')) throw new Error('A pending or uncertain transfer exists on this account and network. Refresh its status and check the explorer before sending again.');
}
export function evmSendLock(network: EvmNetworkId, owner: string) { return `forma.evm.send:${evmNetworks[network].chainId}:${getAddress(owner).toLowerCase()}`; }

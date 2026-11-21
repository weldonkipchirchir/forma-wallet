import { getAddress } from 'ethers';
import { evmNetworks, type EvmNetworkId } from './evm-networks';
import { savedTokens, type Token } from './token-data';
import { parseJournal, type TokenSubmission } from './token-journal';

export const evmTokenKey = (network: EvmNetworkId, owner: string) => `forma.evm.tokens.v1:${evmNetworks[network].chainId}:${getAddress(owner).toLowerCase()}`;
export const evmJournalKey = (network: EvmNetworkId, owner: string) => `forma.evm.submissions.v1:${evmNetworks[network].chainId}:${getAddress(owner).toLowerCase()}`;
type ReadStore = Pick<Storage, 'getItem'>;
export function readEvmTokens(store: ReadStore, network: EvmNetworkId, owner: string): Token[] {
  try { return savedTokens(JSON.parse(store.getItem(evmTokenKey(network, owner)) || '[]')); } catch { return []; }
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

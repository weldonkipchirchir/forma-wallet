import { getAddress, id, zeroPadValue, type Filter, type TransactionRequest } from 'ethers';
import { tokenInterface, type Token } from './token-data';
import { safeTokenText } from './transfer-safety';

export const DISCOVERY_BLOCK_WINDOW = 5000;
export const DISCOVERY_LOG_LIMIT = 200;
export const DISCOVERY_CANDIDATE_LIMIT = 20;
export const DISCOVERY_CONCURRENCY = 3;
export const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');
export function tokenDiscoveryPreferenceKey(owner: string, chainId: bigint) {
  if (chainId <= 0n) throw new Error('Invalid discovery network.');
  return `forma.token-discovery.auto.v1:${chainId}:${getAddress(owner).toLowerCase()}`;
}
export type DiscoveryProvider = {
  getNetwork(): Promise<{ chainId: bigint }>;
  getBlockNumber(): Promise<number>;
  getLogs(filter: Filter): Promise<unknown[]>;
  getCode(address: string): Promise<string>;
  call(request: TransactionRequest): Promise<string>;
};
export type TokenDiscoveryResult = { tokens: Token[]; fromBlock: number; toBlock: number; scannedLogs: number; candidates: number; limited: boolean; warnings: string[] };
export type TokenDiscoveryOptions = { owner: string; chainId: bigint; provider: DiscoveryProvider; current?: () => boolean };

/** Candidate discovery only. Events and contract labels do not certify a token's issuer. */
export async function discoverEvmTokens(options: TokenDiscoveryOptions): Promise<TokenDiscoveryResult> {
  const owner = getAddress(options.owner), { provider, chainId } = options;
  if (chainId <= 0n) throw new Error('Invalid discovery network.');
  const live = () => { if (options.current && !options.current()) throw new Error('Wallet or network changed. Discovery results were discarded.'); };
  const checkNetwork = async () => { const actual = await provider.getNetwork(); live(); if (actual.chainId !== chainId) throw new Error('Wrong network returned by RPC. Token discovery stopped.'); };
  live(); await checkNetwork();
  const toBlock = await provider.getBlockNumber(); live();
  if (!Number.isSafeInteger(toBlock) || toBlock < 0) throw new Error('Invalid discovery block height.');
  const fromBlock = Math.max(0, toBlock - DISCOVERY_BLOCK_WINDOW + 1), recipientTopic = zeroPadValue(owner, 32).toLowerCase();
  const raw = await provider.getLogs({ fromBlock, toBlock, topics: [TRANSFER_TOPIC, null, recipientTopic] }); live();
  if (!Array.isArray(raw)) throw new Error('Invalid discovery event response.');
  const rows = raw.slice(0, DISCOVERY_LOG_LIMIT), candidates = new Map<string, string>();
  let limited = raw.length > DISCOVERY_LOG_LIMIT;
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { address?: unknown; topics?: unknown; data?: unknown; blockNumber?: unknown; removed?: unknown };
    if (row.removed === true || !Array.isArray(row.topics) || row.topics.length !== 3
      || typeof row.topics[0] !== 'string' || row.topics[0].toLowerCase() !== TRANSFER_TOPIC
      || typeof row.topics[1] !== 'string' || !/^0x[0-9a-f]{64}$/i.test(row.topics[1])
      || typeof row.topics[2] !== 'string' || row.topics[2].toLowerCase() !== recipientTopic
      || typeof row.data !== 'string' || !/^0x[0-9a-f]{64}$/i.test(row.data) || BigInt(row.data) === 0n
      || typeof row.blockNumber !== 'number' || !Number.isSafeInteger(row.blockNumber) || row.blockNumber < fromBlock || row.blockNumber > toBlock
      || typeof row.address !== 'string') continue;
    try {
      const address = getAddress(row.address), key = address.toLowerCase();
      if (address === '0x0000000000000000000000000000000000000000' || candidates.has(key)) continue;
      if (candidates.size >= DISCOVERY_CANDIDATE_LIMIT) { limited = true; continue; }
      candidates.set(key, address);
    } catch { /* Ignore invalid indexer/provider records. */ }
  }
  const addresses = [...candidates.values()], tokens: Array<Token | undefined> = new Array(addresses.length);
  let next = 0, unavailable = 0;
  const call = async (address: string, method: string, args: readonly unknown[] = []) => {
    const response = await provider.call({ to: address, data: tokenInterface.encodeFunctionData(method, args) }); live();
    if (typeof response !== 'string' || response.length > 4096) throw new Error('Unsupported token response.');
    return tokenInterface.decodeFunctionResult(method, response)[0];
  };
  await Promise.all(Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, addresses.length) }, async () => {
    while (next < addresses.length) {
      live(); const index = next++, address = addresses[index];
      try {
        const code = await provider.getCode(address); live();
        if (typeof code !== 'string' || code === '0x' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) continue;
        // Sequential calls per worker keep the total RPC concurrency at three.
        const decimals = Number(await call(address, 'decimals'));
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue;
        const balance = BigInt(await call(address, 'balanceOf', [owner]));
        if (balance <= 0n || balance >= 2n ** 256n) continue;
        const name = await call(address, 'name'), symbol = await call(address, 'symbol');
        if (!safeTokenText(name, 80) || !safeTokenText(symbol, 20)) continue;
        tokens[index] = { address, name, symbol, decimals };
      } catch { live(); unavailable++; }
    }
  }));
  await checkNetwork(); live();
  return { tokens: tokens.filter((token): token is Token => !!token), fromBlock, toBlock, scannedLogs: rows.length, candidates: addresses.length, limited, warnings: [
    'Only recent incoming standard ERC-20 transfer events are searched. Older balances, nonstandard tokens and unsupported events may be missed.',
    'A positive contract balance and a token label do not verify authenticity. Confirm the contract with its issuer before using it.',
    ...(limited ? ['The discovery limit was reached; use manual contract import for additional assets.'] : []),
    ...(unavailable ? [`${unavailable} candidate contract(s) could not be verified by this RPC.`] : []),
  ] };
}

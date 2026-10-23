import { hex, base64 } from '@scure/base';
import { BTC_GENESIS, SOL_GENESIS, verifyUtxo, type MultiKeys, type Chain } from './multichain-core';
export const BTC_API = 'https://blockstream.info/testnet/api';
export const SOL_API = 'https://api.devnet.solana.com';
export function safeNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Network returned an invalid amount or counter.');
  return value;
}
async function request(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000), referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('Testnet service unavailable or rate limited. Try refreshing later.');
  const text = await response.text();
  if (text.length > 2000000) throw new Error('Testnet response is too large.');
  return text;
}
export async function solRpc(method: string, params: unknown[] = []): Promise<any> {
  const data = JSON.parse(await request(SOL_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }));
  if (data.error || data.result === undefined) throw new Error('Solana Devnet request failed. Check balance, fee and service availability.');
  return data.result;
}
export async function assertTestnet(chain: Chain) {
  const genesis = chain === 'btc' ? await request(`${BTC_API}/block-height/0`) : await solRpc('getGenesisHash');
  if (genesis !== (chain === 'btc' ? BTC_GENESIS : SOL_GENESIS)) throw new Error('Wrong network. Signing is blocked.');
}
export async function readMultiBalance(chain: Chain, keys: Pick<MultiKeys, 'solAddress' | 'btcAddress'>) {
  await assertTestnet(chain);
  if (chain === 'sol') {
    const result = await solRpc('getBalance', [keys.solAddress, { commitment: 'confirmed' }]);
    return { confirmed: BigInt(safeNumber(result?.value)), unconfirmed: 0n };
  }
  const result = JSON.parse(await request(`${BTC_API}/address/${keys.btcAddress}`));
  const balance = (stats: any) => BigInt(safeNumber(stats?.funded_txo_sum)) - BigInt(safeNumber(stats?.spent_txo_sum));
  const confirmed = balance(result.chain_stats);
  if (confirmed < 0n) throw new Error('Invalid Bitcoin balance response.');
  return { confirmed, unconfirmed: balance(result.mempool_stats) };
}
export async function bitcoinFunding(keys: MultiKeys) {
  await assertTestnet('btc');
  const data = JSON.parse(await request(`${BTC_API}/address/${keys.btcAddress}/utxo`));
  if (!Array.isArray(data) || data.length > 2000) throw new Error('Unsupported Bitcoin UTXO response.');
  const seen = new Set<string>();
  const rows = data.filter(row => row?.status?.confirmed === true).map(row => {
    if (!/^[a-f0-9]{64}$/.test(row.txid)) throw new Error('Invalid Bitcoin transaction ID.');
    const vout = safeNumber(row.vout), value = BigInt(safeNumber(row.value)), id = `${row.txid}:${vout}`;
    if (value <= 0n || seen.has(id)) throw new Error('Invalid or duplicate Bitcoin funding output.');
    seen.add(id); return { txid: row.txid as string, vout, value };
  }).slice(0, 20);
  const verified = [];
  for (const row of rows) {
    const raw = (await request(`${BTC_API}/tx/${row.txid}/hex`)).trim();
    if (!/^(?:[a-f0-9]{2})+$/i.test(raw)) throw new Error('Invalid Bitcoin funding transaction.');
    verified.push(verifyUtxo(hex.decode(raw), row.txid, row.vout, row.value, keys.btcScript));
  }
  return verified;
}
export async function assertUnspent(txid: string, vout: number) {
  const row = JSON.parse(await request(`${BTC_API}/tx/${txid}/outspend/${vout}`));
  if (row?.spent !== false) throw new Error('Bitcoin input was spent. Refresh and review again.');
}
export async function broadcastBitcoin(raw: string, expected: string) {
  const id = (await request(`${BTC_API}/tx`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: raw })).trim();
  if (id !== expected) throw new Error('Bitcoin broadcast result differs. Check the explorer before retrying.');
}
export async function solSimulate(raw: Uint8Array) {
  const result = await solRpc('simulateTransaction', [base64.encode(raw), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
  if (result?.value?.err !== null) throw new Error('Solana simulation failed. Check recipient, balance, minimum account funding and fees. Nothing was broadcast.');
}
export async function broadcastSol(raw: Uint8Array, expected: string) {
  const id = await solRpc('sendTransaction', [base64.encode(raw), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]);
  if (id !== expected) throw new Error('Solana broadcast result differs. Check the explorer before retrying.');
}
export async function submissionStatus(chain: Chain, id: string): Promise<'unknown' | 'pending' | 'confirmed' | 'failed'> {
  await assertTestnet(chain);
  if (chain === 'btc') {
    const row = JSON.parse(await request(`${BTC_API}/tx/${id}/status`));
    return row?.confirmed === true ? 'confirmed' : row?.confirmed === false ? 'pending' : 'unknown';
  }
  const result = await solRpc('getSignatureStatuses', [[id], { searchTransactionHistory: true }]);
  const row = result?.value?.[0];
  if (!row) return 'unknown';
  if (row.err != null) return 'failed';
  return ['confirmed', 'finalized'].includes(row.confirmationStatus) ? 'confirmed' : 'pending';
}
export const multiExplorer = (chain: Chain, kind: 'address' | 'tx', id: string) => chain === 'btc'
  ? `https://blockstream.info/testnet/${kind}/${encodeURIComponent(id)}`
  : `https://explorer.solana.com/${kind}/${encodeURIComponent(id)}?cluster=devnet`;
export type NetworkActivity = { id: string; status: 'pending' | 'confirmed' | 'failed'; timestamp: number | null };
export async function readMultiActivity(chain: Chain, address: string): Promise<NetworkActivity[]> {
  await assertTestnet(chain);
  const rows = chain === 'btc'
    ? JSON.parse(await request(`${BTC_API}/address/${encodeURIComponent(address)}/txs`))
    : await solRpc('getSignaturesForAddress', [address, { limit: 20, commitment: 'confirmed' }]);
  if (!Array.isArray(rows)) throw new Error('Invalid activity response.');
  return rows.slice(0, 20).map(row => {
    const id = chain === 'btc' ? row?.txid : row?.signature;
    if (typeof id !== 'string' || !(chain === 'btc' ? /^[a-f0-9]{64}$/ : /^[1-9A-HJ-NP-Za-km-z]{80,90}$/).test(id)) throw new Error('Invalid activity transaction ID.');
    const time = chain === 'btc' ? row.status?.block_time : row.blockTime;
    return { id, status: chain === 'btc' ? row.status?.confirmed === true ? 'confirmed' : 'pending' : row.err ? 'failed' : 'confirmed', timestamp: typeof time === 'number' && Number.isSafeInteger(time) && time > 0 ? time * 1000 : null };
  });
}

import { AbiCoder } from 'ethers';
import { boundedJson } from './bounded-response';
import { safeTokenText } from './transfer-safety';
import { tronAddress, tronHexAddress, tronQuantity, TRON_NILE_GENESIS, type TronToken } from './tron-core';

export const TRON_NILE_RPC = 'https://nile.trongrid.io';
export const TRON_NILE_EXPLORER = 'https://nile.tronscan.org';
const abi = AbiCoder.defaultAbiCoder();
async function request(path: string, payload?: unknown) {
  const response = await fetch(TRON_NILE_RPC + path, {
    method: payload === undefined ? 'GET' : 'POST',
    ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('TRON Nile service is unavailable or rate limited.');
  const data = await boundedJson(response, 1_000_000);
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.Error || data.error) throw new Error('TRON Nile returned an invalid response.');
  return data;
}
export async function assertTronNile() {
  const data = await request('/wallet/getblockbynum', { num: 0 });
  if (data.blockID !== TRON_NILE_GENESIS) throw new Error('Wrong TRON network. Expected the pinned Nile genesis block.');
}
export async function readTronBalance(owner: string) {
  const address = tronAddress(owner); await assertTronNile();
  const data = await request('/wallet/getaccount', { address, visible: true });
  if (data.address === undefined) {
    if (Object.keys(data).length === 0) return { balance: 0n, activated: false };
    throw new Error('TRON account response is missing its identity.');
  }
  if (typeof data.address !== 'string' || tronAddress(data.address) !== address) throw new Error('TRON returned a different account.');
  return { balance: tronQuantity(data.balance ?? 0, 63), activated: true };
}
async function constant(owner: string, contract: string, selector: string, parameter = ''): Promise<string> {
  const data = await request('/wallet/triggerconstantcontract', { owner_address: tronAddress(owner), contract_address: tronAddress(contract), function_selector: selector, parameter, visible: true });
  if (data.result?.result !== true || !Array.isArray(data.constant_result) || data.constant_result.length !== 1 || typeof data.constant_result[0] !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(data.constant_result[0]) || data.constant_result[0].length > 8192) throw new Error('TRC-20 read failed or returned unsupported data.');
  return '0x' + data.constant_result[0];
}
export async function readTrc20Balance(owner: string, contract: string): Promise<bigint> {
  await assertTronNile();
  const parameter = tronHexAddress(owner).slice(2).padStart(64, '0');
  const raw = await constant(owner, contract, 'balanceOf(address)', parameter);
  return tronQuantity(abi.decode(['uint256'], raw)[0].toString());
}
export async function readTrc20Token(owner: string, contract: string): Promise<TronToken> {
  const address = tronAddress(contract); await assertTronNile();
  const [nameRaw, symbolRaw, decimalsRaw] = await Promise.all([constant(owner, address, 'name()'), constant(owner, address, 'symbol()'), constant(owner, address, 'decimals()')]);
  const name = abi.decode(['string'], nameRaw)[0], symbol = abi.decode(['string'], symbolRaw)[0], decimals = Number(abi.decode(['uint256'], decimalsRaw)[0]);
  if (!safeTokenText(name, 80) || !safeTokenText(symbol, 20) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsafe or unsupported TRC-20 metadata.');
  return { address, name, symbol, decimals };
}
export function discoveredTronContracts(data: unknown, owner: string): string[] {
  if (!data || typeof data !== 'object' || !('data' in data) || !Array.isArray(data.data) || data.data.length > 1) throw new Error('Invalid TRON token discovery response.');
  if (!data.data.length) return [];
  const account = data.data[0];
  if (!account || typeof account.address !== 'string' || tronAddress(account.address) !== tronAddress(owner) || !Array.isArray(account.trc20)) throw new Error('Token discovery did not identify the selected TRON account.');
  const found = new Set<string>();
  for (const row of account.trc20.slice(0, 100)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const [candidate, quantity] of Object.entries(row).slice(0, 1)) {
      try { if (tronQuantity(quantity) > 0n) found.add(tronAddress(candidate)); } catch { /* Ignore malformed untrusted indexer candidates. */ }
    }
    if (found.size >= 10) break;
  }
  return [...found];
}
export async function discoverTronContracts(owner: string): Promise<string[]> {
  const address = tronAddress(owner); await assertTronNile();
  const data = await request(`/v1/accounts/${address}?only_confirmed=true`);
  if (data.success !== true) throw new Error('TRON discovery is unavailable. Import a contract manually.');
  return discoveredTronContracts(data, address);
}

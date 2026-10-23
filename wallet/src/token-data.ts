import { getAddress, parseUnits, Interface, ZeroAddress } from 'ethers';
import { safeTokenText } from './transfer-safety';
export const ERC20_ABI = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address to,uint256 amount) returns (bool)'];
export const tokenInterface = new Interface(ERC20_ABI);
export type Token = { address: string; name: string; symbol: string; decimals: number; hidden?: boolean };
export const tokenKey = (wallet: string) => `forma.sepolia.tokens.v1:${wallet.toLowerCase()}`;
export function tokenAddress(value: string) {
  let address: string;
  try { address = getAddress(value.trim()); } catch { throw new Error('Enter a valid Ethereum contract or recipient address.'); }
  if (address === ZeroAddress) throw new Error('The zero address is not allowed.');
  return address;
}
export function tokenAmount(value: string, decimals: number) {
  if (value.length > 120) throw new Error('Token amount is too long.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals (0–36 supported).');
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error('Enter a positive token amount without exponent notation.');
  let amount: bigint;
  try { amount = parseUnits(value.trim(), decimals); } catch { throw new Error(`This token supports at most ${decimals} decimal places.`); }
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Token amount is outside the supported range.');
  return amount;
}
export function savedTokens(raw: unknown): Token[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.slice(0, 25).flatMap(t => {
    if (!t || !safeTokenText(t.name, 80) || !safeTokenText(t.symbol, 20) || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) return [];
    try { return [{ address: tokenAddress(t.address), name: t.name, symbol: t.symbol, decimals: t.decimals, hidden: t.hidden === true }]; } catch { return []; }
  });
  return [...new Map(valid.map(t => [t.address, t])).values()];
}
export function loadTokens(wallet: string) { try { return savedTokens(JSON.parse(localStorage.getItem(tokenKey(wallet)) || '[]')); } catch { return []; } }
export type TokenTransfer = { hash: string; contract: string; from: string; to: string; value: string; timestamp: string; index: number };
export function parseTokenTransfers(raw: unknown): TokenTransfer[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected token history response.');
  return raw.flatMap(r => {
    if (!r || !/^0x[\da-f]{64}$/i.test(r.transaction_hash) || typeof r.total?.value !== 'string' || !/^\d{1,78}$/.test(r.total.value) || !Number.isFinite(Date.parse(r.timestamp)) || !Number.isSafeInteger(r.log_index)) return [];
    try { return [{ hash: r.transaction_hash, contract: tokenAddress(r.token?.address_hash ?? r.token?.address), from: getAddress(r.from?.hash), to: getAddress(r.to?.hash), value: r.total.value, timestamp: r.timestamp, index: r.log_index }]; } catch { return []; }
  });
}

import { HDNodeWallet, Wallet, SigningKey, computeAddress, getBytes } from 'ethers';
import { base58check, hex } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { safeTokenText } from './transfer-safety';

export const TRON_PATH = "m/44'/195'/0'/0/0";
export const TRON_NILE_GENESIS = '0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc';
export const TRON_NILE_CHAIN_ID = 3448148188;
export const TRON_TOKEN_LIMIT = 100;
export const TRON_TEST_USDT = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const codec = base58check(sha256);
export type TronToken = { address: string; name: string; symbol: string; decimals: number };

export function tronAddressFromPublicKey(publicKey: string): string {
  const evm = getBytes(computeAddress(SigningKey.computePublicKey(publicKey, false)));
  const payload = new Uint8Array(21); payload[0] = 0x41; payload.set(evm, 1);
  return codec.encode(payload);
}
export function tronAddress(value: string): string {
  const candidate = value.trim();
  let bytes: Uint8Array;
  try { bytes = /^41[0-9a-f]{40}$/i.test(candidate) ? hex.decode(candidate) : codec.decode(candidate); }
  catch { throw new Error('Enter a valid TRON Base58Check address starting with T.'); }
  if (bytes.length !== 21 || bytes[0] !== 0x41) throw new Error('Invalid TRON address prefix or length.');
  return codec.encode(bytes);
}
export const tronHexAddress = (value: string) => hex.encode(codec.decode(tronAddress(value)));
export function tronDerivationPath(wallet: HDNodeWallet): string {
  const match = wallet.path?.match(/^m\/44'\/60'\/0'\/0\/(\d{1,10})$/);
  if (!match || Number(match[1]) > 0x7fffffff) throw new Error('TRON derivation supports standard Ethereum account-index paths only.');
  return `m/44'/195'/0'/0/${Number(match[1])}`;
}
export function deriveTronAddress(wallet: Wallet | HDNodeWallet): string {
  if (!(wallet instanceof HDNodeWallet) || !wallet.mnemonic) throw new Error('TRON derivation requires a phrase-backed wallet. An imported Ethereum private key does not establish its original TRON account.');
  if (wallet.mnemonic.password) throw new Error('This phrase uses a BIP-39 passphrase that the shared backup cannot preserve. TRON derivation is unavailable for this import.');
  const path = tronDerivationPath(wallet), seed = getBytes(wallet.mnemonic.computeSeed());
  try { return tronAddressFromPublicKey(HDNodeWallet.fromSeed(seed).derivePath(path).publicKey); }
  finally { seed.fill(0); }
}
export const tronTokenKey = (owner: string) => `forma.tron.nile.tokens.v1:${tronAddress(owner)}`;
export function parseTronTokens(value: unknown): TronToken[] {
  if (!Array.isArray(value)) return [];
  const tokens = new Map<string, TronToken>();
  for (const item of value.slice(0, TRON_TOKEN_LIMIT)) {
    if (!item || typeof item !== 'object' || typeof item.address !== 'string' || !safeTokenText(item.name, 80) || !safeTokenText(item.symbol, 20) || !Number.isInteger(item.decimals) || item.decimals < 0 || item.decimals > 36) continue;
    try { const address = tronAddress(item.address); tokens.set(address, { address, name: item.name, symbol: item.symbol, decimals: item.decimals }); } catch { /* Invalid public cache entry. */ }
  }
  return [...tokens.values()];
}
export function tronQuantity(value: unknown, maxBits = 256): bigint {
  const text = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,78}$/.test(text)) throw new Error('TRON returned an invalid integer amount.');
  const amount = BigInt(text);
  if (amount >= 2n ** BigInt(maxBits)) throw new Error('TRON amount exceeds its supported range.');
  return amount;
}

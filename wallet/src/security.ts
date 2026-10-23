import type { Activity } from './activity';
import { Wallet } from 'ethers';
import { validatePassword } from './wallet';

export async function restoreBackup(json: string, backupPassword: string, localPassword: string, confirmation: string) {
  validatePassword(localPassword, confirmation);
  validateKeystore(json);
  const wallet = await Wallet.fromEncryptedJson(json, backupPassword);
  return { wallet, encrypted: await wallet.encrypt(localPassword) };
}

export function cachedActivity(value: unknown): Activity[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1000).filter((t): t is Activity => !!t && typeof t === 'object'
    && /^0x[\da-f]{64}$/i.test(t.hash) && /^0x[\da-f]{40}$/i.test(t.from)
    && (t.to === '' || /^0x[\da-f]{40}$/i.test(t.to))
    && typeof t.value === 'string' && /^\d{1,78}$/.test(t.value)
    && typeof t.timestamp === 'string' && Number.isFinite(Date.parse(t.timestamp))
    && ['pending', 'confirmed', 'failed'].includes(t.status)
    && ['transaction', 'internal'].includes(t.kind)
    && typeof t.id === 'string' && /^0x[\da-f]{64}(:\d+)?$/i.test(t.id));
}

export function validateKeystore(json: string) {
  if (json.length > 100_000) throw new Error('Keystore file is too large.');
  let data;
  try { data = JSON.parse(json); } catch { throw new Error('Choose a valid encrypted keystore JSON file.'); }
  const crypto = data?.Crypto ?? data?.crypto;
  const params = crypto?.kdfparams;
  if (!params || crypto.cipher !== 'aes-128-ctr') throw new Error('Unsupported keystore encryption.');
  const hex = (value: unknown, bytes: number) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`, 'i').test(value);
  if (data.version !== 3 || !hex(crypto.ciphertext, 32) || !hex(crypto.cipherparams?.iv, 16)
    || !hex(crypto.mac, 32) || typeof params.salt !== 'string'
    || !/^[0-9a-f]{32,128}$/i.test(params.salt) || params.salt.length % 2 !== 0
    || (crypto.kdf === 'pbkdf2' && params.prf !== 'hmac-sha256')) throw new Error('Malformed or unsupported keystore structure.');
  const bounded = (v: unknown, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max;
  if (crypto.kdf === 'scrypt') {
    if (!bounded(params.n, 262144) || (params.n & (params.n - 1)) !== 0 || !bounded(params.r, 8) || !bounded(params.p, 16) || params.n * params.r * params.p > 2097152) throw new Error('Keystore work factor is unsupported. Import it with its original wallet software.');
  } else if (crypto.kdf === 'pbkdf2') {
    if (!bounded(params.c, 1000000)) throw new Error('Keystore work factor is unsupported.');
  } else throw new Error('Unsupported keystore key derivation.');
  if (params.dklen !== 32) throw new Error('Unsupported keystore key length.');
}

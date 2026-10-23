import { describe, it, expect } from 'vitest';
import { cachedActivity, validateKeystore } from './security';
describe('untrusted wallet inputs', () => {
  it('rejects injected or malformed cached activity', () => {
    expect(cachedActivity([{ status: '" onclick="alert(1)', hash: 'x' }])).toEqual([]);
    expect(cachedActivity({})).toEqual([]);
  });
  it('bounds imported key derivation work', () => {
    const json = (n: number) => JSON.stringify({ version: 3, Crypto: { ciphertext: '11'.repeat(32), cipherparams: { iv: '22'.repeat(16) }, mac: '33'.repeat(32), cipher: 'aes-128-ctr', kdf: 'scrypt', kdfparams: { salt: '44'.repeat(32), n, r: 8, p: 1, dklen: 32 } } });
    expect(() => validateKeystore(json(131072))).not.toThrow();
    expect(() => validateKeystore(json(1073741824))).toThrow('work factor');
    expect(() => validateKeystore(json(100))).toThrow('work factor');
    expect(() => validateKeystore('not-json')).toThrow();
  });
});

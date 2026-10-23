import { describe, expect, it } from 'vitest';
import { Wallet, type TransactionRequest } from 'ethers';
import { assertSignedMatchesReview } from './transfer-safety';
import { validateKeystore, restoreBackup } from './security';

// Public, disposable fixture. Never fund it.
const signer = new Wallet('0x' + '11'.repeat(32));
const review: TransactionRequest = { to: '0x' + '22'.repeat(20), value: 123n, data: '0x',
  chainId: 11155111n, type: 2, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };

describe('serialized transaction intent binding', () => {
  it('accepts exactly the reviewed native transfer', async () => {
    const raw = await signer.signTransaction(review);
    expect(() => assertSignedMatchesReview(raw, review, signer.address)).not.toThrow();
  });
  it.each([
    ['destination', { to: '0x' + '33'.repeat(20) }], ['amount', { value: 124n }],
    ['calldata', { data: '0x1234' }], ['chain', { chainId: 1n }],
    ['gas limit', { gasLimit: 21001n }], ['max fee', { maxFeePerGas: 11n }],
    ['priority fee', { maxPriorityFeePerGas: 2n }],
    ['access list', { accessList: [{ address: '0x' + '44'.repeat(20), storageKeys: [] }] }],
  ])('rejects substituted %s', async (_name, change) => {
    const raw = await signer.signTransaction({ ...review, ...change });
    expect(() => assertSignedMatchesReview(raw, review, signer.address)).toThrow('differs');
  });
  it('rejects another signing key', async () => {
    const other = Wallet.createRandom();
    const raw = await signer.signTransaction(review);
    expect(() => assertSignedMatchesReview(raw, review, other.address)).toThrow();
  });
  it('binds token transfer calldata as well', async () => {
    const token = { ...review, value: 0n, data: '0xa9059cbb' + '00'.repeat(64), gasLimit: 60000n };
    const raw = await signer.signTransaction(token);
    expect(() => assertSignedMatchesReview(raw, token, signer.address)).not.toThrow();
    expect(() => assertSignedMatchesReview(raw, { ...token, data: token.data + '00' }, signer.address)).toThrow();
  });
});

describe('hostile backup structure', () => {
  it('requires a strong confirmed local password before decrypting a backup', async () => {
    await expect(restoreBackup('{}', 'old', 'short', 'short')).rejects.toThrow('12');
    await expect(restoreBackup('{}', 'old', 'a strong new local password', 'different')).rejects.toThrow('match');
  });
  it('restores an older weak-password backup into a newly encrypted local vault', async () => {
    const oldJson = await signer.encrypt('old');
    const restored = await restoreBackup(oldJson, 'old', 'a strong new local password', 'a strong new local password');
    expect(restored.wallet.address).toBe(signer.address);
    const recovered = await Wallet.fromEncryptedJson(restored.encrypted, 'a strong new local password');
    expect(recovered.address).toBe(signer.address);
    await expect(Wallet.fromEncryptedJson(restored.encrypted, 'old')).rejects.toThrow();
  }, 30000);
  it.each([null, [], {}, { version: 3 }, { crypto: { cipher: 'aes-128-ctr', kdfparams: {} } }])('rejects malformed backup %j', value => {
    expect(() => validateKeystore(JSON.stringify(value))).toThrow();
  });
  it('accepts an ethers encrypted backup and detects corrupt fields', async () => {
    const json = await signer.encrypt('a disposable test password');
    expect(() => validateKeystore(json)).not.toThrow();
    for (const field of ['ciphertext', 'mac']) {
      const broken = JSON.parse(json); broken.Crypto[field] = 'xyz';
      expect(() => validateKeystore(JSON.stringify(broken))).toThrow('structure');
    }
  }, 20000);
});

import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { verifyBackup, changePassword, commitPassword, commitGroupPassword } from './recovery';

describe('recovery management', () => {
  it('verifies address ownership and changes encryption without changing the key', async () => {
    const wallet = Wallet.createRandom();
    const json = await wallet.encrypt('original test password');
    expect((await verifyBackup(json, 'original test password', wallet.address)).address).toBe(wallet.address);
    await expect(verifyBackup(json, 'wrong', wallet.address)).rejects.toThrow();
    await expect(verifyBackup(json, 'original test password', Wallet.createRandom().address)).rejects.toThrow('different wallet');
    const updated = await changePassword(json, 'original test password', 'new disposable password', 'new disposable password', wallet.address);
    expect((await verifyBackup(updated, 'new disposable password', wallet.address)).address).toBe(wallet.address);
    await expect(verifyBackup(updated, 'original test password', wallet.address)).rejects.toThrow();
    expect((await verifyBackup(json, 'original test password', wallet.address)).address).toBe(wallet.address);
  }, 60000);
  it('rejects weak or mismatched new passwords before decryption', async () => {
    await expect(changePassword('{}', 'old', 'short', 'short', 'x')).rejects.toThrow('12');
    await expect(changePassword('{}', 'old', 'long enough password', 'different', 'x')).rejects.toThrow('match');
  });
  it('updates the matching archive entry and rolls back on active-vault write failure', () => {
    const map = new Map([['vault', 'old'], ['archive', JSON.stringify({ other: 'preserved' })]]);
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { if (k === 'vault' && v === 'fail') throw new Error('quota'); map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    expect(() => commitPassword(storage, 'vault', 'archive', '0xabc', 'old', 'fail')).toThrow('quota');
    expect(JSON.parse(map.get('archive')!)).toEqual({ other: 'preserved' });
    expect(map.get('vault')).toBe('old');
    commitPassword(storage, 'vault', 'archive', '0xabc', 'old', 'new');
    expect(JSON.parse(map.get('archive')!)).toEqual({ other: 'preserved', abc: 'new' });
    expect(map.get('vault')).toBe('new');
    expect(() => commitPassword(storage, 'vault', 'archive', '0xabc', 'old', 'again')).toThrow('changed');
  });
  it('re-encrypts every account and rolls back all vaults on failure', () => {
    const map = new Map([['vault', 'active-old'], ['acct', 'other-old'], ['archive', JSON.stringify({ other: 'preserved' })]]);
    let failOn = '';
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { if (k === failOn) throw new Error('quota'); map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
    const active = `0x${'22'.repeat(20)}`;
    const updates = [
      { address: `0x${'11'.repeat(20)}`, vaultKey: 'acct', oldJson: 'other-old', nextJson: 'other-new' },
      { address: active, vaultKey: 'vault', oldJson: 'active-old', nextJson: 'active-new' },
    ];
    expect(() => commitGroupPassword(storage, 'vault', 'archive', active, updates)).not.toThrow();
    expect(map.get('vault')).toBe('active-new');
    expect(map.get('acct')).toBe('other-new');
    expect(JSON.parse(map.get('archive')!)).toEqual({ other: 'preserved', ['11'.repeat(20)]: 'other-new', ['22'.repeat(20)]: 'active-new' });
    map.set('vault', 'active-old'); map.set('acct', 'other-old'); map.set('archive', JSON.stringify({ other: 'preserved' }));
    failOn = 'vault';
    expect(() => commitGroupPassword(storage, 'vault', 'archive', active, updates)).toThrow('quota');
    expect(map.get('vault')).toBe('active-old');
    expect(map.get('acct')).toBe('other-old');
    expect(JSON.parse(map.get('archive')!)).toEqual({ other: 'preserved' });
    expect(() => commitGroupPassword(storage, 'vault', 'archive', active, [updates[0]])).toThrow('Active account');
    map.set('archive', '{');
    expect(() => commitGroupPassword(storage, 'vault', 'archive', active, updates)).toThrow('damaged');
    expect(map.get('vault')).toBe('active-old');
  });
});

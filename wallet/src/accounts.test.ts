import { describe, expect, it } from 'vitest';
import { HDNodeWallet, Wallet } from 'ethers';
import { importPhrase } from './wallet';
import {
  ACCOUNTS_KEY, MAX_ACCOUNTS_PER_GROUP, accountLabel, accountVaultKey, adoptActiveVault,
  deriveHdAccount, findAccount, findGroup, loadAccountRegistry, nextHdIndex, parseAccountRegistry,
  privateKeyInput, registerNewAccount, renameAccount, vaultMetadata,
} from './accounts';

const phrase = 'test test test test test test test test test test test junk';
const password = 'disposable account test password';

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

describe('account registry', () => {
  it('adopts a phrase-backed vault once and copies it without overwriting newer encryption', async () => {
    const wallet = importPhrase(phrase, '', 2);
    const json = await wallet.encrypt(password);
    const storage = memory({ 'forma.sepolia.vault.v1': json });
    const first = adoptActiveVault(storage, json);
    const second = adoptActiveVault(storage, json);
    expect(first.accounts).toHaveLength(1);
    expect(first.accounts[0]).toMatchObject({ address: wallet.address, kind: 'hd', index: 2 });
    expect(second.accounts).toEqual(first.accounts);
    expect(loadAccountRegistry(storage).groups).toHaveLength(1);
    expect(storage.getItem(accountVaultKey(wallet.address))).toBe(json);
    const newer = await wallet.encrypt('a different local password');
    storage.setItem(accountVaultKey(wallet.address), newer);
    adoptActiveVault(storage, json);
    expect(storage.getItem(accountVaultKey(wallet.address))).toBe(newer);
  }, 60000);

  it('marks a standalone imported key as not phrase-backed', async () => {
    const source = Wallet.createRandom();
    const imported = privateKeyInput(source.privateKey);
    const json = await imported.encrypt(password);
    const group = adoptActiveVault(memory(), json);
    expect(group.accounts[0]).toMatchObject({ address: imported.address, kind: 'imported' });
    expect(group.accounts[0].index).toBeUndefined();
    expect(accountLabel(group.accounts[0])).toBe('Imported account');
  }, 60000);

  it('parses only bounded, checksummed and deduplicated records', () => {
    const a0 = Wallet.createRandom().address, a1 = Wallet.createRandom().address, a2 = Wallet.createRandom().address, a3 = Wallet.createRandom().address;
    const now = new Date().toISOString();
    const registry = parseAccountRegistry({
      version: 1,
      groups: [
        { primary: 'not-an-address', accounts: [{ address: a0, kind: 'hd', index: 0, addedAt: now }] },
        { primary: a0, accounts: [
          { address: a0, kind: 'hd', index: 0, nickname: 'Spending', addedAt: now },
          { address: a0, kind: 'imported', addedAt: now },
          { address: '0x1234', kind: 'hd', index: 1, addedAt: now },
          { address: a1, kind: 'imported', addedAt: now },
          { address: a2, kind: 'hd', index: 500, addedAt: now },
          { address: a2, kind: 'hd', index: 1, addedAt: 'not a date' },
          { address: a3, kind: 'imported', addedAt: now, nickname: 'Cold' },
        ] },
        { primary: a1, accounts: [{ address: a1, kind: 'imported', addedAt: now }] },
      ],
    });
    expect(registry.groups).toHaveLength(1);
    expect(registry.groups[0].accounts.map(account => account.address)).toEqual([a0, a1, a3]);
    expect(findGroup(registry, a1.toLowerCase())?.primary).toBe(a0);
  });

  it('registers derived and imported accounts, rejecting duplicates and full groups', async () => {
    const root = importPhrase(phrase, '', 0);
    const rootJson = await root.encrypt(password);
    const storage = memory();
    const group = adoptActiveVault(storage, rootJson);
    const sibling = deriveHdAccount(root, 1);
    const siblingJson = await sibling.encrypt(password);
    const next = registerNewAccount(storage, group.primary, { address: sibling.address, kind: 'hd', index: 1, addedAt: new Date().toISOString() }, siblingJson);
    expect(next.accounts).toHaveLength(2);
    expect(findAccount(loadAccountRegistry(storage), sibling.address)?.index).toBe(1);
    expect(() => registerNewAccount(storage, group.primary, { address: sibling.address, kind: 'hd', index: 1, addedAt: new Date().toISOString() }, siblingJson)).toThrow('already in your wallet');
    const imported = privateKeyInput(Wallet.createRandom().privateKey);
    const importedJson = await imported.encrypt(password);
    registerNewAccount(storage, group.primary, { address: imported.address, kind: 'imported', addedAt: new Date().toISOString() }, importedJson);
    expect(findAccount(loadAccountRegistry(storage), imported.address)?.kind).toBe('imported');
  }, 60000);

  it('renames with bounded text and can clear a nickname', async () => {
    const wallet = importPhrase(phrase, '', 0);
    const json = await wallet.encrypt(password);
    const storage = memory();
    adoptActiveVault(storage, json);
    renameAccount(storage, wallet.address, '  Spending  ');
    expect(findAccount(loadAccountRegistry(storage), wallet.address)?.nickname).toBe('Spending');
    renameAccount(storage, wallet.address, '   ');
    expect(findAccount(loadAccountRegistry(storage), wallet.address)?.nickname).toBeUndefined();
    expect(() => renameAccount(storage, wallet.address, 'bad\u0000name')).toThrow('control characters');
    expect(() => renameAccount(storage, Wallet.createRandom().address, 'Nope')).toThrow('not found');
  }, 60000);

  it('derives siblings from the same phrase and refuses passphrase-derived wallets', () => {
    const root = importPhrase(phrase, '', 0);
    expect(deriveHdAccount(root, 1).address).toBe(importPhrase(phrase, '', 1).address);
    expect(deriveHdAccount(root, 1).address).not.toBe(deriveHdAccount(root, 2).address);
    expect(() => deriveHdAccount(root, 101)).toThrow('between 0 and 100');
    const passphraseWallet = HDNodeWallet.fromPhrase(phrase, 'extra', "m/44'/60'/0'/0/0");
    expect(() => deriveHdAccount(passphraseWallet, 1)).toThrow('passphrase');
  });

  it('suggests the next sequential index and wraps only when indexes run out', () => {
    const addedAt = new Date().toISOString();
    const record = (index: number) => ({ address: Wallet.createRandom().address, kind: 'hd' as const, index, addedAt });
    expect(nextHdIndex(undefined)).toBe(0);
    expect(nextHdIndex({ primary: 'x', accounts: [] })).toBe(0);
    expect(nextHdIndex({ primary: 'x', accounts: [record(0), record(2)] })).toBe(3);
    expect(nextHdIndex({ primary: 'x', accounts: [record(100)] })).toBe(0);
    const full = Array.from({ length: MAX_ACCOUNTS_PER_GROUP + 1 }, (_, index) => record(index));
    expect(() => nextHdIndex({ primary: 'x', accounts: full })).toThrow('indexes');
  });

  it('reads legacy keystore metadata without decrypting it', async () => {
    const wallet = importPhrase(phrase, '', 4);
    const json = await wallet.encrypt(password);
    expect(vaultMetadata(json)).toEqual({ address: wallet.address, index: 4, hasPhrase: true });
    const imported = await privateKeyInput(Wallet.createRandom().privateKey).encrypt(password);
    expect(vaultMetadata(imported).hasPhrase).toBe(false);
    expect(vaultMetadata(imported).index).toBeUndefined();
  }, 60000);

  it('rolls back the copied vault when registry storage fails', async () => {
    const wallet = importPhrase(phrase, '', 0);
    const json = await wallet.encrypt(password);
    const base = memory();
    let fail = true;
    const storage = { ...base, setItem: (key: string, value: string) => { if (fail && key === ACCOUNTS_KEY) throw new Error('quota'); base.setItem(key, value); } };
    expect(() => adoptActiveVault(storage, json)).toThrow('quota');
    expect(storage.getItem(accountVaultKey(wallet.address))).toBeNull();
    expect(storage.getItem(ACCOUNTS_KEY)).toBeNull();
    fail = false;
    expect(adoptActiveVault(storage, json).accounts).toHaveLength(1);
  }, 60000);

  it('normalizes private keys and rejects malformed values', () => {
    const wallet = Wallet.createRandom();
    expect(privateKeyInput(wallet.privateKey.slice(2)).address).toBe(wallet.address);
    expect(privateKeyInput(wallet.privateKey.toUpperCase().replace('0X', '0x')).address).toBe(wallet.address);
    for (const bad of ['', '0x1234', 'zz'.repeat(32), `${'11'.repeat(32)}11`]) {
      expect(() => privateKeyInput(bad)).toThrow('64-character hexadecimal');
    }
  });
});

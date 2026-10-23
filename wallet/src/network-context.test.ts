import { describe, it, expect } from 'vitest';
import { networkAsset, networkHeading, usesNativeWorkspace, supportsPage, savedNetwork } from './network-context';
import { marketMarkup } from './market';
import { preserveImportedWallet, savedWalletLabel } from './wallet-migration';
import { commitPassword } from './recovery';

describe('selected network context', () => {
  it('restores supported saved networks and safely defaults invalid preferences', () => {
    expect(savedNetwork('sol')).toBe('sol');
    expect(savedNetwork('btc')).toBe('btc');
    expect(savedNetwork(null)).toBe('eth');
    expect(savedNetwork('mainnet')).toBe('eth');
  });
  it('keeps overview, holdings, transfers and activity on the selected native chain', () => {
    for (const chain of ['btc', 'sol'] as const) {
      for (const page of ['overview', 'portfolio', 'transfer', 'activity']) expect(usesNativeWorkspace(chain, page)).toBe(true);
      expect(supportsPage(chain, 'market')).toBe(true);
      expect(supportsPage(chain,'ledger')).toBe(false);
      expect(supportsPage(chain,'tokens')).toBe(chain==='sol');
      for (const page of ['contacts', 'watch']) expect(supportsPage(chain, page)).toBe(true);
    }
    expect(usesNativeWorkspace('eth', 'transfer')).toBe(false);
    expect(networkHeading('sol', 'activity')).toBe('Solana activity');
  });
  it('labels each market, chart and source with its own spot pair', () => {
    for (const network of ['eth', 'btc', 'sol'] as const) {
      const asset = networkAsset(network), markup = marketMarkup(network);
      expect(markup).toContain(`${asset.name} market`);
      expect(markup).toContain(`Binance spot ${asset.pair}`);
      expect(markup).toContain(`Interactive ${asset.name} USDT`);
      if (network !== 'eth') expect(markup).not.toContain('ETHUSDT');
    }
  });
});
describe('normal saved-wallet migration', () => {
  const address = 'a'.repeat(40), oldKey = 'forma.multichain.testnets.v1';
  const vault = JSON.stringify({ address, version: 3, Crypto: { ciphertext: '11'.repeat(32), cipherparams: { iv: '22'.repeat(16) }, mac: '33'.repeat(32), cipher: 'aes-128-ctr', kdf: 'scrypt', kdfparams: { salt: '44'.repeat(32), n: 131072, r: 8, p: 1, dklen: 32 } } });
  function fixture() {
    const rows = new Map<string, string>([[oldKey, vault], ['archive', JSON.stringify({ primary: 'untouched' })]]);
    return { rows, store: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } } };
  }
  it('archives an old vault once without changing its blob or existing wallets', () => {
    const { rows, store } = fixture();
    expect(preserveImportedWallet(store, 'archive')).toBe(true);
    const saved = JSON.parse(rows.get('archive')!);
    expect(saved.primary).toBe('untouched');
    expect(saved[`imported:${address}`]).toBe(vault);
    expect(rows.get(oldKey)).toBe(vault);
    expect(preserveImportedWallet(store, 'archive')).toBe(false);
    expect(savedWalletLabel(`imported:${address}`, vault)).toContain(`0x${address}`);
  });
  it('does not revive an old password from an imported alias after password change', () => {
    const { rows, store } = fixture();
    preserveImportedWallet(store, 'archive'); rows.set('active', vault);
    const next = JSON.stringify({ ...JSON.parse(vault), updated: true });
    commitPassword(store, 'active', 'archive', `0x${address}`, vault, next);
    const archive = JSON.parse(rows.get('archive')!);
    expect(archive[`imported:${address}`]).toBe(next);
    expect(archive[address]).toBe(next);
    expect(preserveImportedWallet(store, 'archive')).toBe(false);
    expect(rows.get(oldKey)).toBe(vault);
  });
  it('preserves original storage if the archive cannot be written', () => {
    const { rows, store } = fixture();
    expect(() => preserveImportedWallet({ ...store, setItem: () => { throw new Error('full'); } }, 'archive')).toThrow('full');
    expect(rows.get(oldKey)).toBe(vault);
    expect(JSON.parse(rows.get('archive')!)).toEqual({ primary: 'untouched' });
  });
});

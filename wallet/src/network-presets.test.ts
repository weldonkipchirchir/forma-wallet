import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { DEFAULT_RPC, securityHeaders } from '../security-policy.mjs';
import { evmNetworks, isAdditionalEvm, requireEvmNetwork, type EvmNetworkId } from './evm-networks';
import { isNetworkId, networkAsset, networkIds, savedNetwork, supportsPage, usesNativeWorkspace } from './network-context';
import { assertSignedMatchesReview } from './transfer-safety';

describe('reviewed EVM testnet presets', () => {
  it('uses unique testnet chain IDs, native currencies and frozen configuration', () => {
    const configs = Object.values(evmNetworks);
    expect(configs).toHaveLength(11);
    expect(new Set(configs.map(config => config.chainId)).size).toBe(configs.length);
    expect(Object.isFrozen(evmNetworks)).toBe(true);
    for (const config of configs) {
      expect(config.testnet).toBe(true);
      expect(config.transactionType).toBe(2);
      expect(config.decimals).toBe(18);
      expect(Number.isSafeInteger(config.chainId) && config.chainId > 0).toBe(true);
      expect(Object.isFrozen(config)).toBe(true);
      for (const value of [config.rpc, config.explorer, config.docs]) {
        const url = new URL(value);
        expect(url.protocol).toBe('https:');
        expect(url.username + url.password + url.search + url.hash).toBe('');
        expect(['localhost', '127.0.0.1', '[::1]']).not.toContain(url.hostname);
      }
    }
    expect(networkAsset('polygon').symbol).toBe('POL');
    expect(networkAsset('avalanche').symbol).toBe('AVAX');
    expect(networkAsset('polygon').pair).toBe('POLUSDT');
    expect(networkAsset('avalanche').pair).toBe('AVAXUSDT');
    // Mainnets and a retired testnet cannot accidentally become selectable.
    for (const id of ['mainnet', 'ethereum', 'scroll', '__proto__', 'constructor']) expect(isAdditionalEvm(id)).toBe(false);
  });

  it('scopes every RPC origin in the production CSP without broadening to arbitrary HTTPS', () => {
    const policy = securityHeaders(new URL(DEFAULT_RPC), true)['Content-Security-Policy'];
    const connect = policy.split(';').find(part => part.trim().startsWith('connect-src '))!;
    const sources = connect.trim().split(/\s+/).slice(1);
    for (const config of Object.values(evmNetworks)) expect(sources).toContain(new URL(config.rpc).origin);
    expect(sources).not.toContain('https:');
    expect(sources).not.toContain('*');
    expect(sources.some(source => source.includes('*'))).toBe(false);
    expect(policy).not.toContain('unsafe-eval');
  });

  it('selects each preset safely without routing it into the BTC/SOL adapter', () => {
    for (const id of Object.keys(evmNetworks) as EvmNetworkId[]) {
      expect(networkIds).toContain(id);
      expect(isNetworkId(id)).toBe(true);
      expect(savedNetwork(id)).toBe(id);
      for (const page of ['overview', 'portfolio', 'tokens', 'transfer', 'activity']) {
        expect(supportsPage(id, page)).toBe(true);
        expect(usesNativeWorkspace(id, page)).toBe(false);
      }
      expect(supportsPage(id, 'ledger')).toBe(false);
      expect(() => requireEvmNetwork(id, BigInt(evmNetworks[id].chainId))).not.toThrow();
      expect(() => requireEvmNetwork(id, 1n)).toThrow('Wrong network');
    }
  });

  it('accepts exact reviewed type-2 transactions and rejects cross-chain replay for every preset', async () => {
    const wallet = Wallet.createRandom(), to = '0x' + '22'.repeat(20);
    for (const config of Object.values(evmNetworks)) {
      const chainId = BigInt(config.chainId);
      const review = { to, value: 123n, nonce: 0, chainId, type: 2, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
      const raw = await wallet.signTransaction(review);
      expect(() => assertSignedMatchesReview(raw, review, wallet.address, chainId)).not.toThrow();
      expect(() => assertSignedMatchesReview(raw, review, wallet.address, 1n)).toThrow('differs');
      expect(() => assertSignedMatchesReview(raw, { ...review, value: 124n }, wallet.address, chainId)).toThrow('differs');
    }
  });
});

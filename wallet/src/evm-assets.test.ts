import { describe, expect, it } from 'vitest';
import { Wallet } from 'ethers';
import { evmNetworks, requireEvmNetwork, isAdditionalEvm } from './evm-networks';
import { evmTokenKey, evmJournalKey, readEvmJournal, readEvmTokens, evmSendLock, requireResolvedEvm, retainEvmSubmission } from './evm-assets';
import { networkIds, savedNetwork, supportsPage, usesNativeWorkspace } from './network-context';
import { assertSignedMatchesReview } from './transfer-safety';
import { type TokenSubmission } from './token-journal';
import { securityHeaders, DEFAULT_RPC } from '../security-policy.mjs';

const owner = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const store = (data: string | null) => ({ getItem: () => data });
const row: TokenSubmission = { hash: '0x' + 'aa'.repeat(32), to: other, contract: '0x' + '00'.repeat(20), amount: '1', decimals: 18, symbol: 'ETH', status: 'unknown', timestamp: '2026-11-21T00:00:00Z', nonce: 0 };
describe('chain-scoped EVM assets', () => {
  it('registers only approved networks and keeps native-chain routes separate', () => {
    for (const [id, network] of Object.entries(evmNetworks)) {
      expect(isAdditionalEvm(id)).toBe(true);
      expect(savedNetwork(id)).toBe(id);
      expect(networkIds).toContain(id);
      expect(usesNativeWorkspace(savedNetwork(id), 'transfer')).toBe(false);
      expect(supportsPage(savedNetwork(id), 'tokens')).toBe(true);
      expect(supportsPage(savedNetwork(id), 'ledger')).toBe(false);
      expect(() => requireEvmNetwork(id as keyof typeof evmNetworks, BigInt(network.chainId))).not.toThrow();
      expect(() => requireEvmNetwork(id as keyof typeof evmNetworks, BigInt(network.chainId)+1n)).toThrow('Wrong network');
      const csp = securityHeaders(new URL(DEFAULT_RPC), true)['Content-Security-Policy'];
      expect(csp).toContain(new URL(network.rpc).origin);
      expect(csp).not.toContain('unsafe-eval');
    }
    expect(isAdditionalEvm('__proto__')).toBe(false);
    expect(savedNetwork('mainnet')).toBe('eth');
  });
  it('isolates the same token address across networks and accounts', () => {
    expect(evmTokenKey('base', owner)).not.toBe(evmTokenKey('arbitrum', owner));
    expect(evmTokenKey('base', owner)).not.toBe(evmTokenKey('base', other));
    expect(evmJournalKey('base', owner)).not.toBe(evmJournalKey('robinhood', owner));
    expect(evmSendLock('base', owner)).not.toBe(evmSendLock('optimism', owner));
    expect(evmSendLock('base', owner.toUpperCase().replace('0X','0x'))).toBe(evmSendLock('base', owner));
    const token = { address: other, name: '<img src=x>', symbol: 'USDT', decimals: 6 };
    expect(readEvmTokens(store(JSON.stringify([token])), 'base', owner)).toHaveLength(1);
    expect(readEvmTokens(store('{broken'), 'base', owner)).toEqual([]);
  });
  it('fails closed for damaged submission storage and blocks uncertain or pending sends', () => {
    expect(() => readEvmJournal(store('{broken'), 'base', owner)).toThrow('damaged');
    expect(() => readEvmJournal(store('{}'), 'base', owner)).toThrow('invalid');
    expect(() => readEvmJournal(store(JSON.stringify([{ ...row, hash: 'bad' }])), 'base', owner)).toThrow('invalid');
    expect(readEvmJournal(store(JSON.stringify([row])), 'base', owner)).toEqual([row]);
    expect(() => requireResolvedEvm([row])).toThrow('uncertain');
    expect(() => requireResolvedEvm([{ ...row, status: 'pending' }])).toThrow();
    expect(() => requireResolvedEvm([{ ...row, status: 'failed' }])).not.toThrow();
  });
  it('retains unresolved sends when adding or acknowledging other records', () => {
    const old = { ...row, hash: '0x' + 'bb'.repeat(32) };
    const resolved = Array.from({ length: 199 }, (_, i) => ({ ...row, hash: '0x' + i.toString(16).padStart(64, '0'), status: 'confirmed' as const }));
    const result = retainEvmSubmission([old, ...resolved], { ...row, status: 'pending' });
    expect(result).toHaveLength(200); expect(result).toContainEqual(old);
    expect(retainEvmSubmission(result, { ...row, status: 'confirmed' })).toContainEqual(old);
  });
  it('binds signed bytes to the selected chain, recipient, amount and nonce', async () => {
    const wallet = Wallet.createRandom();
    const request = { chainId: 84532n, type: 2, to: other, value: 1n, nonce: 4, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
    const signed = await wallet.signTransaction(request);
    expect(() => assertSignedMatchesReview(signed, request, wallet.address, 84532n)).not.toThrow();
    expect(() => assertSignedMatchesReview(signed, request, wallet.address, 46630n)).toThrow('differs');
    expect(() => assertSignedMatchesReview(signed, { ...request, nonce: 5 }, wallet.address, 84532n)).toThrow('differs');
    expect(() => assertSignedMatchesReview(signed, { ...request, to: owner }, wallet.address, 84532n)).toThrow('differs');
    // Existing Sepolia-only callers remain Sepolia-only by default.
    expect(() => assertSignedMatchesReview(signed, request, wallet.address)).toThrow('differs');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbiCoder, HDNodeWallet, Wallet } from 'ethers';
import { deriveTronAddress, parseTronTokens, tronAddress, tronDerivationPath, tronHexAddress, tronQuantity, tronTokenKey, TRON_NILE_GENESIS, TRON_TEST_USDT } from './tron-core';
import { assertTronNile, discoveredTronContracts, readTrc20Balance, readTrc20Token, readTronBalance, TRON_NILE_RPC } from './tron-network';

const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = () => HDNodeWallet.fromPhrase(phrase);
const owner = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const other = () => deriveTronAddress(HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/1"));
const json = (value: unknown) => new Response(JSON.stringify(value));
const abi = AbiCoder.defaultAbiCoder();
afterEach(() => vi.unstubAllGlobals());
describe('TRON Nile account identity', () => {
  it('matches the official TRON Ledger public derivation vector and preserves selected index', () => {
    // Official fixture: github.com/tronprotocol/app-tron, never use its public seed for funds.
    expect(deriveTronAddress(root())).toBe(owner);
    const second = HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/1");
    expect(tronDerivationPath(second)).toBe("m/44'/195'/0'/0/1");
    expect(deriveTronAddress(second)).not.toBe(owner);
    expect(tronAddress(tronHexAddress(owner))).toBe(owner);
  });
  it('rejects checksum corruption, Ethereum addresses and incompatible imports', () => {
    expect(() => tronAddress(owner.slice(0, -1) + 'A')).toThrow();
    expect(() => tronAddress('0x' + '11'.repeat(20))).toThrow();
    expect(() => deriveTronAddress(root().deriveChild(1))).toThrow('account-index');
    const keyOnly = new Wallet('0x' + '11'.repeat(32));
    expect(() => deriveTronAddress(keyOnly)).toThrow('phrase-backed');
    expect(() => deriveTronAddress(HDNodeWallet.fromPhrase(phrase, 'optional passphrase'))).toThrow('passphrase');
  });
  it('isolates contract tracking by TRON account and rejects unsafe metadata/amounts', () => {
    expect(tronTokenKey(owner)).not.toBe(tronTokenKey(other()));
    const token = { address: TRON_TEST_USDT, name: 'Test USDT', symbol: 'USDT', decimals: 6 };
    expect(parseTronTokens([token, token, { ...token, symbol: '\u202eUSDT' }, { ...token, decimals: 37 }])).toEqual([token]);
    expect(tronQuantity('18446744073709551615')).toBe(18446744073709551615n);
    for (const value of [-1, Number.MAX_SAFE_INTEGER + 1, '1e6', '1.5']) expect(() => tronQuantity(value)).toThrow();
  });
});
describe('bounded TRON Nile reads', () => {
  it('checks pinned genesis before account data and rejects a different network', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return json({ blockID: 'wrong' }); }));
    await expect(readTronBalance(owner)).rejects.toThrow('Wrong TRON network');
    expect(calls).toEqual([TRON_NILE_RPC + '/wallet/getblockbynum']);
  });
  it('returns exact liquid balance, distinguishes unactivated accounts and validates identity', async () => {
    let account: unknown = { address: tronHexAddress(owner), balance: '1234567890123456' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      expect(options.credentials).toBe('omit'); expect(options.redirect).toBe('error');
      return json(url.endsWith('getblockbynum') ? { blockID: TRON_NILE_GENESIS } : account);
    }));
    expect(await readTronBalance(owner)).toEqual({ balance: 1234567890123456n, activated: true });
    account = {}; expect(await readTronBalance(owner)).toEqual({ balance: 0n, activated: false });
    account = { address: other(), balance: 1 }; await expect(readTronBalance(owner)).rejects.toThrow('different account');
    account = { address: owner, balance: Number.MAX_SAFE_INTEGER + 1 }; await expect(readTronBalance(owner)).rejects.toThrow('invalid integer');
  });
  it('reads standard TRC-20 metadata and encodes 20-byte ABI owner without TRON prefix', async () => {
    let badMetadata = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith('getblockbynum')) return json({ blockID: TRON_NILE_GENESIS });
      const payload = JSON.parse(String(options.body));
      expect(payload.visible).toBe(true); expect(payload.owner_address).toBe(owner); expect(payload.contract_address).toBe(TRON_TEST_USDT);
      const selector = payload.function_selector;
      if (selector === 'balanceOf(address)') expect(payload.parameter).toBe(tronHexAddress(owner).slice(2).padStart(64, '0'));
      const result = selector === 'name()' ? abi.encode(['string'], ['Test USD']) : selector === 'symbol()' ? abi.encode(['string'], [badMetadata ? '\u202eUSDT' : 'USDT']) : selector === 'decimals()' ? abi.encode(['uint256'], [6]) : abi.encode(['uint256'], [123450000n]);
      return json({ result: { result: true }, constant_result: [result.slice(2)] });
    }));
    expect(await readTrc20Token(owner, TRON_TEST_USDT)).toEqual({ address: TRON_TEST_USDT, name: 'Test USD', symbol: 'USDT', decimals: 6 });
    expect(await readTrc20Balance(owner, TRON_TEST_USDT)).toBe(123450000n);
    badMetadata = true; await expect(readTrc20Token(owner, TRON_TEST_USDT)).rejects.toThrow('metadata');
  });
  it('rejects oversized payloads and remote errors without trusting HTTP200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { headers: { 'Content-Length': '1000001' } })));
    await expect(assertTronNile()).rejects.toThrow('supported size');
    vi.stubGlobal('fetch', vi.fn(async () => json({ Error: 'untrusted detail' })));
    await expect(assertTronNile()).rejects.toThrow('invalid response');
  });
  it('treats discovered contracts as bounded positive candidates tied to the owner', () => {
    const body = { data: [{ address: owner, trc20: [{ [TRON_TEST_USDT]: '123' }, { [TRON_TEST_USDT]: '456' }, { [other()]: '0' }, { invalid: '1' }] }] };
    expect(discoveredTronContracts(body, owner)).toEqual([TRON_TEST_USDT]);
    expect(() => discoveredTronContracts(body, other())).toThrow('selected TRON account');
    expect(discoveredTronContracts({ data: [] }, owner)).toEqual([]);
  });
});

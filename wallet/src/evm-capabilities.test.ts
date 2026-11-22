import { describe, expect, it, vi } from 'vitest';
import { evmTokenPage, parseEvmTokens, readEvmTokens, loadEvmPageBalances, EVM_TOKEN_LIMIT, EVM_TOKEN_PAGE_SIZE, EVM_BALANCE_CONCURRENCY } from './evm-assets';
import { verifyEvmTokenTransfer } from './evm-workspace';
import { tokenInterface, type Token } from './token-data';
import type { TransactionRequest } from 'ethers';

const owner = '0x' + '11'.repeat(20);
const token = (index: number): Token => ({ address: '0x' + index.toString(16).padStart(40, '0'), name: `Synthetic token ${index}`, symbol: `T${index}`, decimals: 6 });
const tokens = Array.from({ length: 300 }, (_, index) => token(index + 1));

describe('bounded EVM token inventory', () => {
  it('supports 250 contracts instead of silently truncating to the legacy 25', () => {
    expect(parseEvmTokens(tokens)).toHaveLength(EVM_TOKEN_LIMIT);
    expect(readEvmTokens({ getItem: () => JSON.stringify(tokens) }, 'base', owner)).toHaveLength(EVM_TOKEN_LIMIT);
    expect(parseEvmTokens(tokens.slice(0, 70))).toHaveLength(70);
    expect(readEvmTokens({ getItem: () => ' '.repeat(500_001) }, 'base', owner)).toEqual([]);
  });
  it('validates each contract, rejects unsafe metadata and deduplicates addresses', () => {
    const parsed = parseEvmTokens([tokens[0], { ...tokens[0], name: 'Latest label' }, { ...tokens[1], symbol: 'bad\u202e' }, { ...tokens[2], decimals: 37 }, { ...tokens[3], address: 'not-an-address' }, tokens[4]]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Latest label');
    expect(parseEvmTokens({ tokens })).toEqual([]);
  });
  it('searches by name, symbol or full contract and clamps pagination', () => {
    const inventory = parseEvmTokens(tokens);
    expect(evmTokenPage(inventory).tokens).toHaveLength(EVM_TOKEN_PAGE_SIZE);
    expect(evmTokenPage(inventory, '', 12)).toMatchObject({ page: 12, pages: 13, total: 250 });
    expect(evmTokenPage(inventory, '', 12).tokens).toHaveLength(10);
    expect(evmTokenPage(inventory, '', 999).page).toBe(12);
    expect(evmTokenPage(inventory, '', -1).page).toBe(0);
    expect(evmTokenPage(inventory, '', NaN).page).toBe(0);
    expect(evmTokenPage(inventory, '  synthetic token 250 ')).toMatchObject({ total: 1, page: 0 });
    expect(evmTokenPage(inventory, 't249').tokens[0].symbol).toBe('T249');
    expect(evmTokenPage(inventory, inventory[5].address).tokens).toEqual([inventory[5]]);
    expect(evmTokenPage(inventory, 'missing')).toMatchObject({ tokens: [], total: 0, pages: 1, page: 0 });
  });
  it('limits a refresh to twenty reads with at most three concurrent requests', async () => {
    let active = 0, maxActive = 0, reads = 0;
    const updates: bigint[] = [];
    await loadEvmPageBalances(tokens, async () => {
      reads++; active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--; return 123n;
    }, () => true, (_token, balance) => updates.push(balance!));
    expect(reads).toBe(EVM_TOKEN_PAGE_SIZE);
    expect(maxActive).toBe(EVM_BALANCE_CONCURRENCY);
    expect(updates).toHaveLength(EVM_TOKEN_PAGE_SIZE);
  });
  it('discards in-flight balances after the session changes and starts no more reads', async () => {
    let current = true, reads = 0;
    const update = vi.fn();
    await loadEvmPageBalances(tokens, async () => { reads++; await Promise.resolve(); current = false; return 123n; }, () => current, update);
    expect(reads).toBe(EVM_BALANCE_CONCURRENCY);
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps an unavailable token distinct from an actual zero balance', async () => {
    const values = new Map<string, bigint | undefined>();
    await loadEvmPageBalances(tokens.slice(0, 2), async item => { if (item.address === tokens[0].address) throw new Error('offline'); return 0n; }, () => true, (item, balance) => values.set(item.address, balance));
    expect(values.has(tokens[0].address)).toBe(true);
    expect(values.get(tokens[0].address)).toBeUndefined();
    expect(values.get(tokens[1].address)).toBe(0n);
  });
});

describe('fresh ERC-20 state and simulation before signing', () => {
  const tracked = token(1);
  const tx: TransactionRequest = { to: tracked.address, value: 0n, data: tokenInterface.encodeFunctionData('transfer', [owner, 100n]) };
  function provider(decimals = 6, balance = 100n, succeeds = true, code = '0x6000') {
    return {
      getCode: vi.fn(async () => code),
      call: vi.fn(async (request: TransactionRequest) => {
        const parsed = tokenInterface.parseTransaction({ data: String(request.data) })!;
        return tokenInterface.encodeFunctionResult(parsed.name, [parsed.name === 'decimals' ? decimals : parsed.name === 'balanceOf' ? balance : succeeds]);
      }),
    };
  }
  it('reads contract existence, decimals, balance and transfer simulation for the owner', async () => {
    const api = provider();
    await expect(verifyEvmTokenTransfer(api, owner, tracked, 100n, tx)).resolves.toBeUndefined();
    expect(api.getCode).toHaveBeenCalledWith(tracked.address);
    expect(api.call).toHaveBeenCalledTimes(3);
    for (const [request] of api.call.mock.calls) expect(request.from).toBe(owner);
  });
  it('rejects removed contracts, changed decimals, insufficient balances and false simulation', async () => {
    await expect(verifyEvmTokenTransfer(provider(6, 100n, true, '0x'), owner, tracked, 100n, tx)).rejects.toThrow('no longer available');
    await expect(verifyEvmTokenTransfer(provider(18), owner, tracked, 100n, tx)).rejects.toThrow('decimals changed');
    await expect(verifyEvmTokenTransfer(provider(6, 99n), owner, tracked, 100n, tx)).rejects.toThrow('Insufficient');
    await expect(verifyEvmTokenTransfer(provider(6, 100n, false), owner, tracked, 100n, tx)).rejects.toThrow('returned false');
  });
  it('rejects a simulation request for another contract, native value or token amount', async () => {
    await expect(verifyEvmTokenTransfer(provider(), owner, tracked, 100n, { ...tx, to: owner })).rejects.toThrow('differs');
    await expect(verifyEvmTokenTransfer(provider(), owner, tracked, 100n, { ...tx, value: 1n })).rejects.toThrow('differs');
    await expect(verifyEvmTokenTransfer(provider(), owner, tracked, 101n, tx)).rejects.toThrow('differs');
  });
});

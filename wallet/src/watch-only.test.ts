import { describe, expect, it, vi } from 'vitest';
import { addWatched, parseWatched, readWatched, watchInput, watchMarkup, watchReadApi, watchTokenKey, type WatchReadApi } from './watch-only';
import type { JsonRpcProvider } from 'ethers';
const address = '0x' + '1'.repeat(40);
const other = '0x' + '2'.repeat(40);
const token = { address: other, name: 'Test', symbol: 'TEST', decimals: 6 };
const record = { hash: '0x' + 'a'.repeat(64), id: '0x' + 'a'.repeat(64), from: other, to: address, value: '1000', timestamp: '2026-10-23T00:00:00Z', status: 'confirmed' as const, kind: 'transaction' as const };
const api = (): WatchReadApi => ({ network: vi.fn(async () => 11155111n), balance: vi.fn(async () => 123n), tokenBalance: vi.fn(async () => 456n), metadata: vi.fn(async () => token), activity: vi.fn(async () => [record]) });

describe('watch-only account boundary', () => {
  it('accepts only named public nonzero Ethereum addresses', () => {
    expect(watchInput(' Account ', address)).toEqual({ name: 'Account', address });
    for (const bad of ['0x' + '0'.repeat(40), '0x' + '1'.repeat(64), 'seed words go here', 'alice.eth']) expect(() => watchInput('Name', bad)).toThrow();
    expect(() => watchInput('Bad\u202eName', address)).toThrow();
  });
  it('validates saved records, rejects duplicates and bounds tracked accounts', () => {
    const row = watchInput('Account', address);
    expect(parseWatched([row, row, null, { name: '<bad>', address: 'oops' }])).toEqual([row]);
    expect(() => addWatched([row], row)).toThrow('already');
    expect(() => addWatched(Array(20).fill(row), watchInput('Other', other))).toThrow('20');
    expect(watchTokenKey(address)).not.toBe(watchTokenKey(other));
    expect(watchTokenKey(address)).not.toContain('forma.sepolia.tokens.v1');
  });
  it('provides no signing or broadcasting operation to the view', () => {
    const reads = watchReadApi({} as JsonRpcProvider);
    expect(Object.keys(reads).sort()).toEqual(['activity', 'balance', 'metadata', 'network', 'tokenBalance']);
    expect(watchMarkup()).toContain('cannot sign or send');
    expect(watchMarkup()).not.toContain('type="password"');
    expect(watchMarkup()).not.toContain('Confirm & send');
  });
  it('fetches only the selected address and exact token balances and merges history', async () => {
    const reads = api();
    const result = await readWatched(reads, address, [token]);
    expect(reads.balance).toHaveBeenCalledWith(address);
    expect(reads.tokenBalance).toHaveBeenCalledWith(other, address);
    expect(result.balance).toEqual({ status: 'fulfilled', value: 123n });
    expect(result.holdings[0]).toEqual({ status: 'fulfilled', value: 456n });
    expect(result.history).toEqual([record]);
  });
  it('blocks reads on another network before loading balances or history', async () => {
    const reads = api(); reads.network = async () => 1n;
    await expect(readWatched(reads, address, [])).rejects.toThrow('Wrong network');
    expect(reads.balance).not.toHaveBeenCalled();
    expect(reads.activity).not.toHaveBeenCalled();
  });
  it('preserves successful reads while labelling failed sources as unavailable', async () => {
    const reads = api(); reads.balance = async () => { throw new Error('RPC unavailable'); };
    reads.activity = async (_address, internal) => { if (internal) throw new Error('Indexer unavailable'); return [record]; };
    reads.tokenBalance = async () => { throw new Error('Contract error'); };
    const result = await readWatched(reads, address, [token]);
    expect(result.balance.status).toBe('rejected');
    expect(result.holdings[0].status).toBe('rejected');
    expect(result.historyUnavailable).toBe(true);
    expect(result.history).toEqual([record]);
  });
});

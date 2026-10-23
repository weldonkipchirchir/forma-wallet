import { describe, expect, it, vi } from 'vitest';
import { Wallet, keccak256 } from 'ethers';
import { inspectSubmission, submitTracked, type SubmissionReadApi } from './transaction-reliability';
import { parseJournal, type TokenSubmission } from './token-journal';
const row: TokenSubmission = { hash: '0x' + '1'.repeat(64), contract: '0x' + '0'.repeat(40), to: '0x' + '2'.repeat(40), amount: '1', decimals: 18, symbol: 'ETH', nonce: 3, timestamp: '2026-10-23T00:00:00Z', status: 'pending' };
const reads = (): SubmissionReadApi => ({ receipt: vi.fn(async () => null), height: vi.fn(async () => 100), transaction: vi.fn(async () => null), minedNonce: vi.fn(async () => 3) });
describe('receipt uncertainty and confirmations', () => {
  it('counts confirmations for success and failed execution', async () => {
    const api = reads(); api.receipt = async () => ({ status: 1, blockNumber: 98 });
    expect(await inspectSubmission(row, api)).toMatchObject({ status: 'confirmed', confirmations: 3 });
    api.receipt = async () => ({ status: 0, blockNumber: 100 });
    expect(await inspectSubmission(row, api)).toMatchObject({ status: 'failed', confirmations: 1 });
  });
  it('does not call missing transactions dropped or failed', async () => {
    expect(await inspectSubmission(row, reads(), Date.parse(row.timestamp) + 600001)).toMatchObject({ status: 'unknown', observation: 'not-seen', confirmations: 0 });
  });
  it('flags consumed nonces without claiming a specific replacement', async () => {
    const api = reads(); api.minedNonce = async () => 4;
    expect(await inspectSubmission(row, api)).toMatchObject({ status: 'unknown', observation: 'nonce-used' });
  });
  it('keeps known mempool transactions pending and handles disappearing receipts', async () => {
    const api = reads(); api.transaction = async () => ({ hash: row.hash });
    expect(await inspectSubmission({ ...row, status: 'confirmed', confirmations: 5 }, api)).toMatchObject({ status: 'pending', confirmations: 0 });
    api.transaction = async () => null;
    expect((await inspectSubmission({ ...row, status: 'confirmed' }, api)).status).toBe('unknown');
  });
  it('clears unverified confirmation counts on RPC errors and inconsistent heights', async () => {
    const api = reads(); api.receipt = async () => { throw new Error('offline'); };
    expect(await inspectSubmission({ ...row, confirmations: 5 }, api)).toMatchObject({ status: 'unknown', confirmations: 0, observation: 'rpc-unavailable' });
    api.receipt = async () => ({ status: 1, blockNumber: 101 });
    expect((await inspectSubmission(row, api)).observation).toBe('rpc-unavailable');
  });
  it('validates added journal fields and remains compatible with older records', () => {
    expect(parseJournal([row])).toHaveLength(1);
    expect(parseJournal([{ ...row, nonce: -1 }, { ...row, confirmations: '100' }, { ...row, observation: '<script>' }])).toEqual([]);
    expect(parseJournal([{ ...row, nonce: undefined }])).toHaveLength(1);
  });
});
describe('persist before broadcast and interrupted sessions', () => {
  async function fixture() {
    const wallet = Wallet.createRandom();
    const raw = await wallet.signTransaction({ to: row.to, value: 1n, chainId: 11155111n, type: 2, nonce: 3, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n });
    return { raw, entry: { ...row, hash: keccak256(raw) } };
  }
  it('persists before broadcasting and after acknowledgement', async () => {
    const { raw, entry } = await fixture(); const events: string[] = [];
    await submitTracked(raw, entry, r => { events.push(r.status); }, async () => { events.push('broadcast'); return { hash: entry.hash }; }, () => true);
    expect(events).toEqual(['unknown', 'broadcast', 'pending']);
  });
  it('does not broadcast on storage failure, session invalidation or changed review', async () => {
    const { raw, entry } = await fixture(); const broadcast = vi.fn(async () => ({ hash: entry.hash }));
    await expect(submitTracked(raw, entry, () => { throw new Error('quota'); }, broadcast, () => true)).rejects.toThrow('quota');
    await expect(submitTracked(raw, entry, () => {}, broadcast, () => false)).rejects.toThrow('Nothing was broadcast');
    let current = true;
    await expect(submitTracked(raw, entry, () => { current = false; }, broadcast, () => current)).rejects.toThrow('Nothing was broadcast');
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('retains an uncertain record across reload after timeout and never retries', async () => {
    const { raw, entry } = await fixture(); let stored = '';
    const broadcast = vi.fn(async () => { throw new Error('timeout after acceptance'); });
    await expect(submitTracked(raw, entry, r => { stored = JSON.stringify([r]); }, broadcast, () => true)).rejects.toThrow('Submission uncertain');
    expect(parseJournal(JSON.parse(stored))[0]).toMatchObject({ hash: entry.hash, status: 'unknown', nonce: 3 });
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
  it('persists acceptance even if the UI locks while broadcast is in flight', async () => {
    const { raw, entry } = await fixture(); let current = true; const saved: TokenSubmission[] = [];
    await submitTracked(raw, entry, r => saved.push(r), async () => { current = false; return { hash: entry.hash }; }, () => current);
    expect(saved.at(-1)?.status).toBe('pending');
  });
  it('keeps original uncertain record if acknowledgement cannot be saved', async () => {
    const { raw, entry } = await fixture(); let stored = '';
    await expect(submitTracked(raw, entry, r => { if (r.status === 'pending') throw new Error('quota'); stored = JSON.stringify([r]); }, async () => ({ hash: entry.hash }), () => true)).rejects.toThrow('uncertain');
    expect(parseJournal(JSON.parse(stored))[0].status).toBe('unknown');
  });
});

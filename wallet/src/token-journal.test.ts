import { describe, expect, it } from 'vitest';
import { journalKey, parseJournal, reconcileJournal, type TokenSubmission } from './token-journal';
const row: TokenSubmission = { hash: '0x' + '1'.repeat(64), contract: '0x' + '2'.repeat(40), to: '0x' + '3'.repeat(40), amount: '1230000', decimals: 6, symbol: 'TEST', timestamp: '2026-10-23T00:00:00Z', status: 'unknown' };
describe('token submission journal', () => {
  it('survives serialization and isolates wallet addresses', () => {
    expect(parseJournal(JSON.parse(JSON.stringify([row])))).toEqual([row]);
    expect(journalKey('0xABC')).toBe(journalKey('0xabc'));
    expect(journalKey('0xabc')).not.toBe(journalKey('0xdef'));
  });
  it('rejects malicious or malformed persisted records', () => {
    expect(parseJournal([{ ...row, hash: '<script>' }, { ...row, decimals: 100 }, { ...row, status: '<img>' }, { ...row, amount: '-1' }])).toEqual([]);
  });
  it('reconciles receipts and never mistakes a missing receipt or RPC error for failure', async () => {
    expect((await reconcileJournal([row], async () => ({ status: 1 })))[0].status).toBe('confirmed');
    expect((await reconcileJournal([row], async () => ({ status: 0 })))[0].status).toBe('failed');
    expect((await reconcileJournal([row], async () => null))[0].status).toBe('unknown');
    expect((await reconcileJournal([{ ...row, status: 'pending' }], async () => null))[0].status).toBe('pending');
    expect((await reconcileJournal([row], async () => { throw new Error('offline'); }))[0].status).toBe('unknown');
    expect((await reconcileJournal([{ ...row, status: 'confirmed' }], async () => null))[0].status).toBe('unknown');
  });
});

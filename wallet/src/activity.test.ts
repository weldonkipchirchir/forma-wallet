import { describe, it, expect } from 'vitest';
import { parseActivity, mergeActivity, historyKey } from './activity';
const hash = '0x' + 'a'.repeat(64);
const row = { hash, from: { hash: '0x' + '1'.repeat(40) }, to: { hash: '0x' + '2'.repeat(40) }, value: '50000000000000000', timestamp: '2026-10-22T12:00:00Z', status: 'ok' };
describe('activity indexing', () => {
  it('parses incoming ETH and failed internal transfers', () => {
    expect(parseActivity([row])[0].value).toBe('50000000000000000');
    expect(parseActivity([{ ...row, transaction_hash: hash, index: 2, success: false }], true)[0].status).toBe('failed');
  });
  it('rejects malformed indexer payloads', () => {
    expect(parseActivity([{ ...row, hash: '<script>' }, { ...row, value: '-1' }])).toEqual([]);
    expect(() => parseActivity({})).toThrow();
  });
  it('does not label unknown status as confirmed or accept injected internal identifiers', () => {
    expect(parseActivity([{ ...row, status: null }])[0].status).toBe('pending');
    expect(parseActivity([{ ...row, index: '<img onerror=alert(1)>' }], true)).toEqual([]);
    expect(parseActivity([{ ...row, value: '1'.repeat(10000) }])).toEqual([]);
    expect(parseActivity([{ ...row, timestamp: 0 }])).toEqual([]);
  });
  it('reconciles pending records, deduplicates and isolates wallet storage', () => {
    const confirmed = parseActivity([row])[0];
    expect(mergeActivity([{ ...confirmed, status: 'pending' }], [confirmed, confirmed])).toEqual([confirmed]);
    expect(historyKey('0xABC')).toBe(historyKey('0xabc'));
    expect(historyKey('0xabc')).not.toBe(historyKey('0xdef'));
  });
});

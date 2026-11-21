import { describe, expect, it } from 'vitest';
import { assertNonceFree, blockingNonceRows, earlierPendingCount } from './nonce-safety';
import type { TokenSubmission } from './token-journal';

const row = (overrides: Partial<TokenSubmission> = {}): TokenSubmission => ({
  hash: `0x${'1'.repeat(64)}`, contract: `0x${'0'.repeat(40)}`, to: `0x${'2'.repeat(40)}`,
  amount: '1', decimals: 18, symbol: 'ETH', timestamp: '2026-11-20T00:00:00Z', status: 'pending', nonce: 3, ...overrides,
});

describe('nonce conflict guard', () => {
  it('blocks a reviewed nonce that an unconfirmed local transfer already uses', () => {
    expect(blockingNonceRows([row()], 3)).toHaveLength(1);
    expect(() => assertNonceFree([row()], 3)).toThrow('already occupies');
    expect(blockingNonceRows([row({ hash: `0x${'a'.repeat(64)}`, nonce: 4 })], 3)).toHaveLength(1);
  });
  it('allows a nonce above unconfirmed transfers and ignores resolved or replaced rows', () => {
    expect(blockingNonceRows([row()], 4)).toHaveLength(0);
    expect(blockingNonceRows([row({ status: 'confirmed' })], 3)).toHaveLength(0);
    expect(blockingNonceRows([row({ status: 'failed' })], 3)).toHaveLength(0);
    expect(blockingNonceRows([row({ replacedBy: `0x${'b'.repeat(64)}` })], 3)).toHaveLength(0);
    expect(blockingNonceRows([row({ nonce: undefined })], 3)).toHaveLength(0);
  });
  it('counts only earlier unresolved transfers for review warnings', () => {
    expect(earlierPendingCount([row(), row({ hash: `0x${'c'.repeat(64)}`, nonce: 2 })], 3)).toBe(1);
    expect(earlierPendingCount([row(), row({ status: 'confirmed', hash: `0x${'d'.repeat(64)}`, nonce: 2 })], 3)).toBe(0);
    expect(earlierPendingCount([row({ status: 'pending', hash: `0x${'f'.repeat(64)}`, nonce: 2 }), row({ status: 'confirmed', hash: `0x${'d'.repeat(64)}`, nonce: 1 })], 3)).toBe(1);
    expect(() => assertNonceFree([row({ nonce: 5 }), row({ nonce: 6, hash: `0x${'e'.repeat(64)}` })], 3)).toThrow('nonce 5, 6');
  });
});

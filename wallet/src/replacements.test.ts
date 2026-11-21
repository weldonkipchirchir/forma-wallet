import { describe, expect, it } from 'vitest';
import { planReplacement, replacementBlockedReason } from './replacements';
import type { TokenSubmission } from './token-journal';

const from = `0x${'a'.repeat(40)}`;
const row = (overrides: Partial<TokenSubmission> = {}): TokenSubmission => ({
  hash: `0x${'1'.repeat(64)}`, contract: `0x${'0'.repeat(40)}`, to: `0x${'2'.repeat(40)}`,
  amount: '1000000000000000', decimals: 18, symbol: 'ETH', timestamp: '2026-11-20T00:00:00Z',
  status: 'pending', nonce: 7, gasLimit: '21000', maxFeePerGas: '2000000000', maxPriorityFeePerGas: '1000000000', ...overrides,
});

describe('replacement planner', () => {
  it('reuses the nonce, recipient, amount and gas limit for a speed-up', () => {
    const plan = planReplacement(row(), from, 'speed-up');
    expect(plan.tx.nonce).toBe(7);
    expect(plan.tx.to).toBe('0x' + '2'.repeat(40));
    expect(plan.tx.value).toBe(1_000_000_000_000_000n);
    expect(plan.tx.gasLimit).toBe(21_000n);
    expect(plan.quote.maxFeePerGas).toBeGreaterThan(2_000_000_000n);
    expect(plan.quote.maxPriorityFeePerGas).toBeGreaterThan(1_000_000_000n);
    expect(plan.tx.chainId).toBe(11155111n);
    expect(plan.tx.type).toBe(2);
  });
  it('builds a zero-value self transfer at the same nonce for a cancel', () => {
    const plan = planReplacement(row(), from, 'cancel');
    expect(plan.tx.to?.toString().toLowerCase()).toBe(from.toLowerCase());
    expect(plan.tx.value).toBe(0n);
    expect(plan.tx.data).toBe('0x');
    expect(plan.tx.gasLimit).toBe(21_000n);
    expect(plan.tx.nonce).toBe(7);
  });
  it('reports why legacy, resolved, replaced and token records cannot be replaced', () => {
    expect(replacementBlockedReason(row({ maxFeePerGas: undefined }))).toMatch(/fee details/);
    expect(replacementBlockedReason(row({ nonce: undefined }))).toMatch(/nonce/);
    expect(replacementBlockedReason(row({ status: 'confirmed' }))).toMatch(/resolved/);
    expect(replacementBlockedReason(row({ replacedBy: `0x${'b'.repeat(64)}` }))).toMatch(/already replaced/);
    expect(replacementBlockedReason(row({ contract: `0x${'3'.repeat(40)}`, symbol: 'TEST', decimals: 6 }))).toMatch(/native ETH/);
  });
  it('refuses to plan a replacement when the record is blocked', () => {
    expect(() => planReplacement(row({ status: 'failed' }), from, 'cancel')).toThrow('resolved');
    expect(() => planReplacement(row({ replacedBy: `0x${'b'.repeat(64)}` }), from, 'speed-up')).toThrow('replaced');
  });
});

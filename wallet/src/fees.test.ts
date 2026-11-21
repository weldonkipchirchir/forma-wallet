import { describe, expect, it } from 'vitest';
import { feePresets, formatGwei, replacementFees, replacementTotal } from './fees';

describe('Forma fee presets', () => {
  it('orders slow, suggested and fast quotes without going below the tip', () => {
    const presets = feePresets({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
    expect(presets.slow.maxPriorityFeePerGas).toBeLessThan(presets.market.maxPriorityFeePerGas);
    expect(presets.fast.maxPriorityFeePerGas).toBeGreaterThan(presets.market.maxPriorityFeePerGas);
    expect(presets.slow.maxFeePerGas).toBeLessThanOrEqual(presets.market.maxFeePerGas);
    expect(presets.fast.maxFeePerGas).toBeGreaterThan(presets.market.maxFeePerGas);
    for (const quote of Object.values(presets)) expect(quote.maxFeePerGas).toBeGreaterThanOrEqual(quote.maxPriorityFeePerGas);
  });
  it('handles zero tips and rejects unusable suggestions', () => {
    const presets = feePresets({ maxFeePerGas: 10n, maxPriorityFeePerGas: 0n });
    expect(presets.slow).toEqual({ maxFeePerGas: 10n, maxPriorityFeePerGas: 0n });
    expect(presets.fast.maxFeePerGas).toBeGreaterThanOrEqual(presets.fast.maxPriorityFeePerGas);
    expect(() => feePresets({ maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })).toThrow();
    expect(() => feePresets({ maxFeePerGas: 1n, maxPriorityFeePerGas: 2n })).toThrow();
  });
});

describe('replacement fee bump', () => {
  it('raises both fields by at least 12.5 percent and never lowers them', () => {
    const original = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
    const next = replacementFees(original);
    expect(next.maxFeePerGas * 8n).toBeGreaterThanOrEqual(original.maxFeePerGas * 9n);
    expect(next.maxPriorityFeePerGas * 8n).toBeGreaterThanOrEqual(original.maxPriorityFeePerGas * 9n);
    expect(next.maxFeePerGas).toBeGreaterThan(original.maxFeePerGas);
    expect(next.maxPriorityFeePerGas).toBeGreaterThan(original.maxPriorityFeePerGas);
  });
  it('rounds up to the next wei and supports a zero tip', () => {
    const next = replacementFees({ maxFeePerGas: 1n, maxPriorityFeePerGas: 0n });
    expect(next.maxFeePerGas).toBe(2n);
    expect(next.maxPriorityFeePerGas).toBe(2n);
    const rounded = replacementFees({ maxFeePerGas: 9n, maxPriorityFeePerGas: 9n });
    expect(rounded.maxFeePerGas).toBe(11n);
  });
  it('totals the worst-case fee and formats gwei without trailing zeros', () => {
    expect(replacementTotal(21_000n, { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1n })).toBe(42_000_000_000_000n);
    expect(formatGwei(1_500_000_000n)).toBe('1.5');
    expect(formatGwei(1_000_000_000n)).toBe('1');
    expect(formatGwei(1n)).toBe('0.000000001');
  });
});

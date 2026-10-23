import { describe, it, expect } from 'vitest';
import { parseCandles, percentageChange, ranges } from './market-data';
describe('market data', () => {
  it('computes gains and losses from comparable prices', () => {
    expect(percentageChange(110, 100)).toBeCloseTo(10);
    expect(percentageChange(90, 100)).toBeCloseTo(-10);
    expect(() => percentageChange(100, 0)).toThrow();
  });
  it('validates OHLC values and converts milliseconds to chart seconds', () => {
    expect(parseCandles([[1700000000000, '10', '12', '9', '11', '25']])[0]).toEqual({ time: 1700000000, open: 10, high: 12, low: 9, close: 11, volume: 25 });
    expect(() => parseCandles([[1700000000000, 10, 8, 9, 11, 25]])).toThrow();
    expect(() => parseCandles([[1700000000000, 10, 12, 9, 'NaN', 25]])).toThrow();
  });
  it('keeps each chart range within the provider limit', () => {
    expect(ranges.every(r => r.limit > 0 && r.limit <= 1000)).toBe(true);
  });
});

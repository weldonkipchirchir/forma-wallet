import { describe, it, expect } from 'vitest';
import { costBasis } from './portfolio-value';
import type { Activity } from './activity';
const address = '0x' + '1'.repeat(40), other = '0x' + '2'.repeat(40);
const deposit: Activity = { id: 'deposit', hash: '0x' + 'a'.repeat(64), from: other, to: address, value: '2000000000000000000', timestamp: '2026-01-01T00:00:00Z', status: 'confirmed', kind: 'transaction' };
describe('hypothetical portfolio basis', () => {
  it('uses weighted deposit prices and reduces basis proportionally on withdrawal', () => {
    const second = { ...deposit, id: 'second', value: '1000000000000000000', timestamp: '2026-01-02T00:00:00Z' };
    const sent = { ...deposit, id: 'sent', from: address, to: other, value: '1000000000000000000', timestamp: '2026-01-03T00:00:00Z' };
    const result = costBasis([deposit, second, sent], address, 2000000000000000000n, new Map([['deposit', 2000], ['second', 3500]]));
    expect(result?.average).toBe(2500);
    expect(result?.basis).toBe(5000);
  });
  it('refuses missing prices or a balance unexplained by loaded deposits', () => {
    expect(costBasis([deposit], address, 1000000000000000000n, new Map())).toBeNull();
    expect(costBasis([deposit], address, 3000000000000000000n, new Map([['deposit', 2000]]))).toBeNull();
  });
});

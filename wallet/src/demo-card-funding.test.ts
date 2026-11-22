import { describe, expect, it } from 'vitest';
import { addDemoCard, emptyDemoCards, freezeDemoCard, purchaseDemo, deleteDemoCard } from './demo-cards';
import { applyDemoConversion, demoConservedValue, demoTokenUnits, formatDemoTokens, loadSamplePortfolio, quoteDemoConversion } from './demo-card-funding';
const now = Date.parse('2026-11-22T12:00:00Z');
const fixture = () => loadSamplePortfolio(addDemoCard(emptyDemoCards(), 'Everyday', 100000, 'card', '0000'));
describe('conserved demo token/card funding', () => {
  it('loads only explicit sample funds once, without a chain or payment call', () => {
    expect(emptyDemoCards().reserve.USDT).toBe('0');
    const state = fixture(); expect(state.reserve.USDT).toBe('1000000000');
    expect(() => loadSamplePortfolio(state)).toThrow('already');
    expect(demoTokenUnits('0.000001')).toBe(1n); expect(formatDemoTokens(123450000n)).toBe('123.45');
    for (const input of ['0', '-1', '1e2', '0.0000001']) expect(() => demoTokenUnits(input)).toThrow();
  });
  it('conserves sample value for token→card→token including fees and exact rounding', () => {
    const state = fixture(), before = demoConservedValue(state);
    const fundQuote = quoteDemoConversion(state, { id: 'fund', cardId: 'card', direction: 'token-to-card', asset: 'USDT', amount: '100' }, now);
    expect(fundQuote).toMatchObject({ grossCents: 10000, feeCents: 100, netCents: 9900 });
    const funded = applyDemoConversion(state, fundQuote, now + 1);
    expect(funded.cards[0].balanceCents).toBe(9900); expect(funded.reserve.USDT).toBe('900000000'); expect(demoConservedValue(funded)).toBe(before);
    const backQuote = quoteDemoConversion(funded, { id: 'back', cardId: 'card', direction: 'card-to-token', asset: 'BTC', amount: '99' }, now + 2);
    const returned = applyDemoConversion(funded, backQuote, now + 3);
    expect(returned.cards[0].balanceCents).toBe(0); expect(BigInt(returned.reserve.BTC)).toBeGreaterThan(BigInt(state.reserve.BTC)); expect(demoConservedValue(returned)).toBe(before);
    expect(returned.feesCents).toBe(199);
  });
  it('retains sub-cent rounding rather than inventing token or USD value', () => {
    const state = fixture(), before = demoConservedValue(state);
    const q = quoteDemoConversion(state, { id: 'round', cardId: 'card', direction: 'token-to-card', asset: 'ETH', amount: '0.000123' }, now);
    const next = applyDemoConversion(state, q, now); expect(BigInt(next.roundingMicroCents)).toBeGreaterThan(0n); expect(demoConservedValue(next)).toBe(before);
  });
  it('blocks expired, future, replayed, stale and tampered quotes', () => {
    const state = fixture(), q = quoteDemoConversion(state, { id: 'q', cardId: 'card', direction: 'token-to-card', asset: 'USDT', amount: '100' }, now);
    expect(() => applyDemoConversion(state, q, now + 60001)).toThrow('expired');
    expect(() => applyDemoConversion(state, q, now - 1)).toThrow('expired');
    expect(() => applyDemoConversion(state, { ...q, netCents: 9999 }, now)).toThrow('changed');
    expect(() => applyDemoConversion(applyDemoConversion(state, q, now), q, now)).toThrow('already');
    expect(() => applyDemoConversion(freezeDemoCard(state, 'card'), q, now)).toThrow('changed');
  });
  it('enforces balances, card limits, freeze and spending conservation', () => {
    const state = fixture();
    expect(() => quoteDemoConversion(state, { id: 'x', cardId: 'card', direction: 'token-to-card', asset: 'ETH', amount: '1' }, now)).toThrow('Insufficient');
    expect(() => quoteDemoConversion(state, { id: 'x', cardId: 'card', direction: 'card-to-token', asset: 'USDT', amount: '1' }, now)).toThrow('Insufficient');
    expect(() => quoteDemoConversion(freezeDemoCard(state, 'card'), { id: 'x', cardId: 'card', direction: 'token-to-card', asset: 'USDT', amount: '1' }, now)).toThrow('Unfreeze');
    const funded = applyDemoConversion(state, quoteDemoConversion(state, { id: 'fund', cardId: 'card', direction: 'token-to-card', asset: 'USDT', amount: '100' }, now), now);
    const spent = purchaseDemo(funded, 'card', 'Sample merchant', 9900, 'buy'); expect(demoConservedValue(spent)).toBe(demoConservedValue(state));
    const deleted = deleteDemoCard(spent, 'card'); expect(demoConservedValue(deleted)).toBe(demoConservedValue(state));
    expect(() => purchaseDemo(spent, 'card', 'Sample merchant', 1, 'buy')).toThrow('already');
  });
});

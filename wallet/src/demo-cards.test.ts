import { describe, expect, it } from 'vitest';
import { addDemoCard, demoCardsKey, demoCents, deleteDemoCard, emptyDemoCards, freezeDemoCard, purchaseDemo, readDemoCards, generateSandboxDetails, SANDBOX_CARD_NUMBERS } from './demo-cards';
import { applyDemoConversion, loadSamplePortfolio, quoteDemoConversion } from './demo-card-funding';
const when = '2026-11-22T00:00:00Z';
const card = () => addDemoCard(emptyDemoCards(), 'Travel', 50000, 'card-1', '1234', when);
const funded = () => { const state = loadSamplePortfolio(card()); return applyDemoConversion(state, quoteDemoConversion(state, { id: 'fund', cardId: 'card-1', direction: 'token-to-card', asset: 'USDT', amount: '505.06' }, Date.parse(when)), Date.parse(when)); };
describe('isolated virtual card demo', () => {
  it('parses USD cents exactly and rejects exponent, precision, overflow and zero', () => {
    expect(demoCents('12.34')).toBe(1234); expect(demoCents('0.01')).toBe(1);
    for (const bad of ['0', '-1', '1e3', '0.001', '10000.01', 'Infinity']) expect(() => demoCents(bad)).toThrow();
  });
  it('scopes data by account and discards unsupported card-number/CVV fields', () => {
    expect(demoCardsKey('0x' + '11'.repeat(20))).not.toBe(demoCardsKey('0x' + '22'.repeat(20)));
    const original = card();
    const data = JSON.parse(JSON.stringify(original)); data.cards[0].cvv = '999'; data.cards[0].number = 'not-a-real-card';
    expect(readDemoCards(JSON.stringify(data))).toEqual(original);
    expect(JSON.stringify(original)).not.toContain('cvv');
  });
  it('enforces freeze and spending limit without affecting wallet funds', () => {
    const spent = purchaseDemo(funded(), 'card-1', 'Sample shop', 49999, 'buy-1', when);
    expect(spent.cards[0].spentCents).toBe(49999);
    expect(() => purchaseDemo(spent, 'card-1', 'shop', 2, 'buy-2', when)).toThrow('remaining limit');
    expect(() => purchaseDemo(freezeDemoCard(card(), 'card-1'), 'card-1', 'shop', 1, 'buy-2', when)).toThrow('frozen');
    expect(freezeDemoCard(freezeDemoCard(card(), 'card-1'), 'card-1').cards).toEqual(card().cards);
    expect(() => purchaseDemo(card(), 'card-1', 'shop', 1, 'buy-2', when)).toThrow('Insufficient');
  });
  it('rejects malformed states, duplicate IDs, control characters and excess cards', () => {
    expect(() => readDemoCards('{bad')).toThrow('damaged');
    expect(() => readDemoCards(JSON.stringify({ ...card(), cards: [card().cards[0], card().cards[0]] }))).toThrow();
    expect(() => addDemoCard(card(), 'bad\u202elabel', 100, 'card-2', '1234', when)).toThrow();
    let state = emptyDemoCards();
    for (let i = 0; i < 5; i++) state = addDemoCard(state, 'Test', 100, `card-${i}`, '0000', when);
    expect(() => addDemoCard(state, 'Sixth', 100, 'six', '0000', when)).toThrow('five');
    expect(deleteDemoCard(card(), 'card-1').cards).toEqual([]);
    expect(() => deleteDemoCard(funded(), 'card-1')).toThrow('Convert');
  });
  it('migrates legacy cards and activity without inventing funded balances', () => {
    const old = { version: 1, cards: [{ id: 'legacy', label: 'Old card', lastFour: '9876', limitCents: 10000, spentCents: 500, frozen: false, createdAt: when }], purchases: [{ id: 'old-buy', cardId: 'legacy', merchant: 'Old shop', cents: 500, when }] };
    const migrated = readDemoCards(JSON.stringify(old));
    expect(migrated.version).toBe(2); expect(migrated.cards[0]).toMatchObject({ id: 'legacy', lastFour: '9876', spentCents: 500, balanceCents: 0 });
    expect(migrated.purchases).toEqual(old.purchases); expect(migrated.sampleLoaded).toBe(false); expect(migrated.reserve.USDT).toBe('0');
  });
  it('selects only published sandbox PANs with synthetic dates and CVVs', () => {
    for (let i = 0; i < SANDBOX_CARD_NUMBERS.length; i++) {
      const state = generateSandboxDetails(card(), 'card-1', [i, 11, 898], new Date(when));
      expect(state.cards[0].lastFour).toBe(SANDBOX_CARD_NUMBERS[i].slice(-4));
      expect(state.cards[0].details).toMatchObject({ panIndex: i, expiryMonth: 12, expiryYear: 2028 + i % 3, demoCvv: '998' });
    }
    const invalid = card(); invalid.cards[0].details = { panIndex: 999, expiryMonth: 1, expiryYear: 2030, demoCvv: '123' };
    expect(() => readDemoCards(JSON.stringify(invalid))).toThrow('sandbox');
  });
});

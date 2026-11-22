import { describe, expect, it } from 'vitest';
import { addDemoCard, demoCardsKey, demoCents, deleteDemoCard, emptyDemoCards, freezeDemoCard, purchaseDemo, readDemoCards } from './demo-cards';
const when = '2026-11-22T00:00:00Z';
const card = () => addDemoCard(emptyDemoCards(), 'Travel', 50000, 'card-1', '1234', when);
describe('isolated virtual card demo', () => {
  it('parses USD cents exactly and rejects exponent, precision, overflow and zero', () => {
    expect(demoCents('12.34')).toBe(1234); expect(demoCents('0.01')).toBe(1);
    for (const bad of ['0', '-1', '1e3', '0.001', '10000.01', 'Infinity']) expect(() => demoCents(bad)).toThrow();
  });
  it('scopes data by account and never persists card credentials', () => {
    expect(demoCardsKey('0x' + '11'.repeat(20))).not.toBe(demoCardsKey('0x' + '22'.repeat(20)));
    const original = card();
    const data = JSON.parse(JSON.stringify(original)); data.cards[0].cvv = '999'; data.cards[0].number = 'not-a-real-card';
    expect(readDemoCards(JSON.stringify(data))).toEqual(original);
    expect(JSON.stringify(original)).not.toContain('cvv');
  });
  it('enforces freeze and spending limit without affecting wallet funds', () => {
    const spent = purchaseDemo(card(), 'card-1', 'Sample shop', 49999, 'buy-1', when);
    expect(spent.cards[0].spentCents).toBe(49999);
    expect(() => purchaseDemo(spent, 'card-1', 'shop', 2, 'buy-2', when)).toThrow('remaining limit');
    expect(() => purchaseDemo(freezeDemoCard(card(), 'card-1'), 'card-1', 'shop', 1, 'buy-2', when)).toThrow('frozen');
    expect(freezeDemoCard(freezeDemoCard(card(), 'card-1'), 'card-1')).toEqual(card());
  });
  it('rejects malformed states, duplicate IDs, control characters and excess cards', () => {
    expect(() => readDemoCards('{bad')).toThrow('damaged');
    expect(() => readDemoCards(JSON.stringify({ ...card(), cards: [card().cards[0], card().cards[0]] }))).toThrow();
    expect(() => addDemoCard(card(), 'bad\u202elabel', 100, 'card-2', '1234', when)).toThrow();
    let state = emptyDemoCards();
    for (let i = 0; i < 5; i++) state = addDemoCard(state, 'Test', 100, `card-${i}`, '0000', when);
    expect(() => addDemoCard(state, 'Sixth', 100, 'six', '0000', when)).toThrow('five');
    expect(deleteDemoCard(purchaseDemo(card(), 'card-1', 'shop', 1, 'buy', when), 'card-1')).toEqual(emptyDemoCards());
  });
});

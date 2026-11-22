import { getAddress } from 'ethers';
import { safeTokenText } from './transfer-safety';

export type DemoCard = { id: string; label: string; lastFour: string; limitCents: number; spentCents: number; frozen: boolean; createdAt: string };
export type DemoPurchase = { id: string; cardId: string; merchant: string; cents: number; when: string };
export type DemoCardState = { version: 1; cards: DemoCard[]; purchases: DemoPurchase[] };
export const demoCardsKey = (owner: string) => `forma.demo-cards.v1:${getAddress(owner).toLowerCase()}`;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const validCents = (value: unknown, zero = false): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (zero ? 0 : 1) && value <= 1_000_000;
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
export function emptyDemoCards(): DemoCardState { return { version: 1, cards: [], purchases: [] }; }
export function demoCents(text: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter a USD demo amount with at most two decimals.');
  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!validCents(cents)) throw new Error('Use a demo amount from $0.01 to $10,000.00.');
  return cents;
}
export function readDemoCards(raw: string | null): DemoCardState {
  if (!raw) return emptyDemoCards();
  if (raw.length > 100_000) throw new Error('Demo card data exceeds its supported size.');
  let state: DemoCardState;
  try { state = JSON.parse(raw); } catch { throw new Error('Demo card data is damaged.'); }
  if (!state || state.version !== 1 || !Array.isArray(state.cards) || state.cards.length > 5 || !Array.isArray(state.purchases) || state.purchases.length > 50) throw new Error('Invalid demo card data.');
  const ids = new Set<string>();
  for (const card of state.cards) {
    if (!card || !validId(card.id) || ids.has(card.id) || !safeTokenText(card.label, 32) || typeof card.lastFour !== 'string' || !/^\d{4}$/.test(card.lastFour) || !validCents(card.limitCents) || !validCents(card.spentCents, true) || card.spentCents > card.limitCents || typeof card.frozen !== 'boolean' || !validDate(card.createdAt)) throw new Error('Invalid demo card data.');
    ids.add(card.id);
  }
  const purchases = new Set<string>();
  for (const item of state.purchases) {
    if (!item || !validId(item.id) || purchases.has(item.id) || !ids.has(item.cardId) || !safeTokenText(item.merchant, 60) || !validCents(item.cents) || !validDate(item.when)) throw new Error('Invalid demo purchase data.');
    purchases.add(item.id);
  }
  // Retain only supported fields; never persist a number, CVV or issuer credential.
  return { version: 1, cards: state.cards.map(({ id, label, lastFour, limitCents, spentCents, frozen, createdAt }) => ({ id, label, lastFour, limitCents, spentCents, frozen, createdAt })), purchases: state.purchases.map(({ id, cardId, merchant, cents, when }) => ({ id, cardId, merchant, cents, when })) };
}
export function addDemoCard(state: DemoCardState, label: string, limitCents: number, id: string, lastFour: string, now = new Date().toISOString()): DemoCardState {
  if (state.cards.length >= 5) throw new Error('Up to five demo cards per account.');
  const card: DemoCard = { id, label: label.trim(), lastFour, limitCents, spentCents: 0, frozen: false, createdAt: now };
  return readDemoCards(JSON.stringify({ ...state, cards: [...state.cards, card] }));
}
export function freezeDemoCard(state: DemoCardState, id: string): DemoCardState {
  if (!state.cards.some(card => card.id === id)) throw new Error('Demo card not found.');
  return { ...state, cards: state.cards.map(card => card.id === id ? { ...card, frozen: !card.frozen } : card) };
}
export function purchaseDemo(state: DemoCardState, cardId: string, merchant: string, cents: number, id: string, now = new Date().toISOString()): DemoCardState {
  const card = state.cards.find(card => card.id === cardId);
  if (!card) throw new Error('Choose a demo card.');
  if (card.frozen) throw new Error('This demo card is frozen. Unfreeze it before simulating a purchase.');
  if (!validCents(cents) || cents > card.limitCents - card.spentCents) throw new Error('The demo purchase exceeds this card’s remaining limit.');
  const next = { ...state, cards: state.cards.map(item => item.id === cardId ? { ...item, spentCents: item.spentCents + cents } : item), purchases: [{ id, cardId, merchant: merchant.trim(), cents, when: now }, ...state.purchases].slice(0, 50) };
  return readDemoCards(JSON.stringify(next));
}
export function deleteDemoCard(state: DemoCardState, id: string): DemoCardState {
  return { ...state, cards: state.cards.filter(card => card.id !== id), purchases: state.purchases.filter(item => item.cardId !== id) };
}

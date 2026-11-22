import { getAddress } from 'ethers';
import { safeTokenText } from './transfer-safety';
export const DEMO_ASSETS = ['USDT', 'ETH', 'SOL', 'BTC', 'TRX'] as const;
export type DemoAsset = typeof DEMO_ASSETS[number];
// Public sandbox values: https://docs.stripe.com/testing . Never generate arbitrary PANs.
export const SANDBOX_CARD_NUMBERS = ['4242424242424242', '4000056655665556', '5555555555554444', '2223003122003222'] as const;
export type SandboxDetails = { panIndex: number; expiryMonth: number; expiryYear: number; demoCvv: string };
export type DemoCard = { id: string; label: string; lastFour: string; limitCents: number; spentCents: number; balanceCents: number; frozen: boolean; createdAt: string; details?: SandboxDetails };
export type DemoPurchase = { id: string; cardId: string; merchant: string; cents: number; when: string };
export type DemoConversion = { id: string; cardId: string; direction: 'token-to-card' | 'card-to-token'; asset: DemoAsset; tokenUnits: string; grossCents: number; netCents: number; feeCents: number; when: string };
export type DemoCardState = { version: 2; revision: number; cards: DemoCard[]; purchases: DemoPurchase[]; conversions: DemoConversion[]; reserve: Record<DemoAsset, string>; sampleLoaded: boolean; feesCents: number; roundingMicroCents: string; archivedSpentCents: number };
export const demoCardsKey = (owner: string) => `forma.demo-cards.v1:${getAddress(owner).toLowerCase()}`;
export const demoId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const validCents = (value: unknown, zero = false, max = 1_000_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= (zero ? 0 : 1) && value <= max;
const validDate = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const units = (value: unknown): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value);
export function emptyDemoCards(): DemoCardState { return { version: 2, revision: 0, cards: [], purchases: [], conversions: [], reserve: { USDT: '0', ETH: '0', SOL: '0', BTC: '0', TRX: '0' }, sampleLoaded: false, feesCents: 0, roundingMicroCents: '0', archivedSpentCents: 0 }; }
export function demoCents(text: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter a USD demo amount with at most two decimals.');
  const [whole, fraction = ''] = text.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!validCents(cents)) throw new Error('Use a demo amount from $0.01 to $10,000.00.');
  return cents;
}
export function readDemoCards(raw: string | null): DemoCardState {
  if (!raw) return emptyDemoCards();
  if (raw.length > 150_000) throw new Error('Demo card data exceeds its supported size.');
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('Demo card data is damaged.'); }
  if (!value || ![1, 2].includes(value.version) || !Array.isArray(value.cards) || value.cards.length > 5 || !Array.isArray(value.purchases) || value.purchases.length > 50) throw new Error('Invalid demo card data.');
  const legacy = value.version === 1, ids = new Set<string>();
  const cards: DemoCard[] = value.cards.map((card: any) => {
    if (!card || !demoId(card.id) || ids.has(card.id) || !safeTokenText(card.label, 32) || typeof card.lastFour !== 'string' || !/^\d{4}$/.test(card.lastFour) || !validCents(card.limitCents) || !validCents(card.spentCents, true) || card.spentCents > card.limitCents || typeof card.frozen !== 'boolean' || !validDate(card.createdAt)) throw new Error('Invalid demo card data.');
    const balanceCents = legacy ? 0 : card.balanceCents;
    if (!validCents(balanceCents, true) || balanceCents + card.spentCents > card.limitCents) throw new Error('Invalid demo card balance.');
    let details: SandboxDetails | undefined;
    if (!legacy && card.details !== undefined) {
      const d = card.details;
      if (!d || !Number.isInteger(d.panIndex) || d.panIndex < 0 || d.panIndex >= SANDBOX_CARD_NUMBERS.length || !Number.isInteger(d.expiryMonth) || d.expiryMonth < 1 || d.expiryMonth > 12 || !Number.isInteger(d.expiryYear) || d.expiryYear < 2020 || d.expiryYear > 2100 || typeof d.demoCvv !== 'string' || !/^\d{3}$/.test(d.demoCvv) || card.lastFour !== SANDBOX_CARD_NUMBERS[d.panIndex].slice(-4)) throw new Error('Invalid sandbox card details.');
      details = { panIndex: d.panIndex, expiryMonth: d.expiryMonth, expiryYear: d.expiryYear, demoCvv: d.demoCvv };
    }
    ids.add(card.id);
    return { id: card.id, label: card.label, lastFour: card.lastFour, limitCents: card.limitCents, spentCents: card.spentCents, balanceCents, frozen: card.frozen, createdAt: card.createdAt, ...(details ? { details } : {}) };
  });
  const purchaseIds = new Set<string>();
  const purchases: DemoPurchase[] = value.purchases.map((item: any) => {
    if (!item || !demoId(item.id) || purchaseIds.has(item.id) || !ids.has(item.cardId) || !safeTokenText(item.merchant, 60) || !validCents(item.cents) || !validDate(item.when)) throw new Error('Invalid demo purchase data.');
    purchaseIds.add(item.id); return { id: item.id, cardId: item.cardId, merchant: item.merchant, cents: item.cents, when: item.when };
  });
  const state = emptyDemoCards();
  if (!legacy) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.sampleLoaded !== 'boolean' || !validCents(value.feesCents, true, 1_000_000_000) || !validCents(value.archivedSpentCents, true, 1_000_000_000) || !units(value.roundingMicroCents) || !value.reserve || !DEMO_ASSETS.every(asset => units(value.reserve[asset])) || !Array.isArray(value.conversions) || value.conversions.length > 100) throw new Error('Invalid demo funding ledger.');
    state.revision = value.revision; state.sampleLoaded = value.sampleLoaded; state.feesCents = value.feesCents; state.roundingMicroCents = value.roundingMicroCents; state.archivedSpentCents = value.archivedSpentCents;
    for (const asset of DEMO_ASSETS) state.reserve[asset] = value.reserve[asset];
    const conversionIds = new Set<string>();
    state.conversions = value.conversions.map((item: any) => {
      if (!item || !demoId(item.id) || conversionIds.has(item.id) || !demoId(item.cardId) || !['token-to-card', 'card-to-token'].includes(item.direction) || !DEMO_ASSETS.includes(item.asset) || !units(item.tokenUnits) || !validCents(item.grossCents) || !validCents(item.netCents) || !validCents(item.feeCents) || item.netCents + item.feeCents !== item.grossCents || !validDate(item.when)) throw new Error('Invalid demo conversion data.');
      conversionIds.add(item.id); return { id: item.id, cardId: item.cardId, direction: item.direction, asset: item.asset, tokenUnits: item.tokenUnits, grossCents: item.grossCents, netCents: item.netCents, feeCents: item.feeCents, when: item.when };
    });
  }
  return { ...state, cards, purchases };
}
const checked = (state: DemoCardState) => readDemoCards(JSON.stringify(state));
export function addDemoCard(state: DemoCardState, label: string, limitCents: number, id: string, lastFour: string, now = new Date().toISOString()): DemoCardState {
  if (state.cards.length >= 5) throw new Error('Up to five demo cards per account.');
  const card: DemoCard = { id, label: label.trim(), lastFour, limitCents, spentCents: 0, balanceCents: 0, frozen: false, createdAt: now };
  return checked({ ...state, revision: state.revision + 1, cards: [...state.cards, card] });
}
export function generateSandboxDetails(state: DemoCardState, id: string, entropy: readonly number[], now = new Date()): DemoCardState {
  if (!state.cards.some(card => card.id === id) || entropy.length !== 3 || entropy.some(value => !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) throw new Error('Invalid sandbox card request.');
  const details = { panIndex: entropy[0] % SANDBOX_CARD_NUMBERS.length, expiryMonth: entropy[1] % 12 + 1, expiryYear: now.getUTCFullYear() + 2 + entropy[0] % 3, demoCvv: String(entropy[2] % 900 + 100) };
  return checked({ ...state, revision: state.revision + 1, cards: state.cards.map(card => card.id === id ? { ...card, lastFour: SANDBOX_CARD_NUMBERS[details.panIndex].slice(-4), details } : card) });
}
export function freezeDemoCard(state: DemoCardState, id: string): DemoCardState {
  if (!state.cards.some(card => card.id === id)) throw new Error('Demo card not found.');
  return { ...state, revision: state.revision + 1, cards: state.cards.map(card => card.id === id ? { ...card, frozen: !card.frozen } : card) };
}
export function purchaseDemo(state: DemoCardState, cardId: string, merchant: string, cents: number, id: string, now = new Date().toISOString()): DemoCardState {
  const card = state.cards.find(card => card.id === cardId);
  if (!card) throw new Error('Choose a demo card.');
  if (state.purchases.some(item => item.id === id)) throw new Error('This demo purchase was already recorded.');
  if (card.frozen) throw new Error('This demo card is frozen. Unfreeze it before simulating a purchase.');
  if (!validCents(cents) || cents > card.limitCents - card.spentCents) throw new Error('The demo purchase exceeds this card’s remaining limit.');
  if (cents > card.balanceCents) throw new Error('Insufficient demo card balance. Fund the card from the sample portfolio first.');
  return checked({ ...state, revision: state.revision + 1, cards: state.cards.map(item => item.id === cardId ? { ...item, spentCents: item.spentCents + cents, balanceCents: item.balanceCents - cents } : item), purchases: [{ id, cardId, merchant: merchant.trim(), cents, when: now }, ...state.purchases].slice(0, 50) });
}
export function deleteDemoCard(state: DemoCardState, id: string): DemoCardState {
  const card = state.cards.find(card => card.id === id);
  if (card?.balanceCents) throw new Error('Convert this demo card balance back to a demo token before deleting it.');
  return { ...state, revision: state.revision + 1, archivedSpentCents: state.archivedSpentCents + (card?.spentCents || 0), cards: state.cards.filter(card => card.id !== id), purchases: state.purchases.filter(item => item.cardId !== id) };
}

import { DEMO_ASSETS, demoCents, demoId, readDemoCards, type DemoAsset, type DemoCardState } from './demo-cards';
export const DEMO_PRICES_CENTS: Record<DemoAsset, number> = { USDT: 100, ETH: 300_000, SOL: 15_000, BTC: 9_000_000, TRX: 25 };
export const DEMO_TOKEN_SCALE = 1_000_000n;
export const DEMO_FEE_BPS = 100;
export const DEMO_QUOTE_LIFETIME_MS = 60_000;
export type DemoQuote = { id: string; cardId: string; direction: 'token-to-card' | 'card-to-token'; asset: DemoAsset; amount: string; tokenUnits: string; grossCents: number; netCents: number; feeCents: number; roundingMicroCents: string; revision: number; createdAt: number; expiresAt: number };
export function demoTokenUnits(value: string): bigint {
  if (!/^\d{1,8}(?:\.\d{1,6})?$/.test(value.trim())) throw new Error('Use a positive demo token amount with at most six decimals.');
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = BigInt(whole) * DEMO_TOKEN_SCALE + BigInt(fraction.padEnd(6, '0'));
  if (amount <= 0n) throw new Error('The demo amount must be greater than zero.');
  return amount;
}
export function formatDemoTokens(units: string | bigint) { const value = BigInt(units); return `${value / DEMO_TOKEN_SCALE}.${String(value % DEMO_TOKEN_SCALE).padStart(6, '0')}`.replace(/\.?0+$/, ''); }
export function loadSamplePortfolio(state: DemoCardState): DemoCardState {
  if (state.sampleLoaded) throw new Error('This account’s sample portfolio has already been loaded.');
  return readDemoCards(JSON.stringify({ ...state, revision: state.revision + 1, sampleLoaded: true, reserve: { USDT: '1000000000', ETH: '200000', SOL: '2000000', BTC: '1000', TRX: '100000000' } }));
}
export function quoteDemoConversion(state: DemoCardState, request: { id: string; cardId: string; direction: DemoQuote['direction']; asset: DemoAsset; amount: string }, now = Date.now()): DemoQuote {
  const card = state.cards.find(card => card.id === request.cardId);
  if (!card || !demoId(request.id) || !DEMO_ASSETS.includes(request.asset) || !['token-to-card', 'card-to-token'].includes(request.direction) || !Number.isSafeInteger(now) || now < 0) throw new Error('Invalid demo conversion request.');
  if (card.frozen) throw new Error('Unfreeze the demo card before converting.');
  const price = BigInt(DEMO_PRICES_CENTS[request.asset]);
  let tokenUnits: bigint, grossCents: number, rounding: bigint;
  if (request.direction === 'token-to-card') {
    tokenUnits = demoTokenUnits(request.amount);
    const value = tokenUnits * price; grossCents = Number(value / DEMO_TOKEN_SCALE); rounding = value % DEMO_TOKEN_SCALE;
  } else { grossCents = demoCents(request.amount); tokenUnits = 0n; rounding = 0n; }
  if (!Number.isSafeInteger(grossCents) || grossCents < 2 || grossCents > 1_000_000) throw new Error('Use a conversion value from $0.02 to $10,000.00.');
  const feeCents = Math.max(1, Math.ceil(grossCents * DEMO_FEE_BPS / 10000)), netCents = grossCents - feeCents;
  if (netCents <= 0) throw new Error('The demo amount is too small after fees.');
  if (request.direction === 'token-to-card') {
    if (tokenUnits > BigInt(state.reserve[request.asset])) throw new Error('Insufficient sample token balance. These balances are separate from your real wallet.');
    if (card.balanceCents + card.spentCents + netCents > card.limitCents) throw new Error('This funding exceeds the card’s total demo spending limit.');
  } else {
    if (grossCents > card.balanceCents) throw new Error('Insufficient demo card balance.');
    const value = BigInt(netCents) * DEMO_TOKEN_SCALE; tokenUnits = value / price; rounding = value - tokenUnits * price;
    if (tokenUnits <= 0n) throw new Error('The demo amount is too small for the selected token.');
  }
  return { ...request, amount: request.amount.trim(), tokenUnits: String(tokenUnits), grossCents, netCents, feeCents, roundingMicroCents: String(rounding), revision: state.revision, createdAt: now, expiresAt: now + DEMO_QUOTE_LIFETIME_MS };
}
export function applyDemoConversion(state: DemoCardState, quote: DemoQuote, now = Date.now()): DemoCardState {
  if (!Number.isSafeInteger(now) || now < quote.createdAt || now > quote.expiresAt || quote.expiresAt !== quote.createdAt + DEMO_QUOTE_LIFETIME_MS) throw new Error('Demo quote expired. Review a fresh quote.');
  if (state.revision !== quote.revision || state.conversions.some(item => item.id === quote.id)) throw new Error('Demo balances changed or this conversion was already applied. Review again.');
  const verified = quoteDemoConversion(state, { id: quote.id, cardId: quote.cardId, direction: quote.direction, asset: quote.asset, amount: quote.amount }, quote.createdAt);
  for (const field of ['tokenUnits', 'grossCents', 'netCents', 'feeCents', 'roundingMicroCents', 'revision'] as const) if (verified[field] !== quote[field]) throw new Error('Demo quote details changed. Review again.');
  const quantity = BigInt(quote.tokenUnits), funding = quote.direction === 'token-to-card';
  const reserve = { ...state.reserve, [quote.asset]: String(BigInt(state.reserve[quote.asset]) + (funding ? -quantity : quantity)) };
  const cards = state.cards.map(card => card.id === quote.cardId ? { ...card, balanceCents: card.balanceCents + (funding ? quote.netCents : -quote.grossCents) } : card);
  const entry = { id: quote.id, cardId: quote.cardId, direction: quote.direction, asset: quote.asset, tokenUnits: quote.tokenUnits, grossCents: quote.grossCents, netCents: quote.netCents, feeCents: quote.feeCents, when: new Date(now).toISOString() };
  return readDemoCards(JSON.stringify({ ...state, revision: state.revision + 1, reserve, cards, feesCents: state.feesCents + quote.feeCents, roundingMicroCents: String(BigInt(state.roundingMicroCents) + BigInt(quote.roundingMicroCents)), conversions: [entry, ...state.conversions].slice(0, 100) }));
}
export function demoConservedValue(state: DemoCardState): bigint {
  return DEMO_ASSETS.reduce((sum, asset) => sum + BigInt(state.reserve[asset]) * BigInt(DEMO_PRICES_CENTS[asset]), 0n)
    + BigInt(state.cards.reduce((sum, card) => sum + card.balanceCents + card.spentCents, 0) + state.feesCents + state.archivedSpentCents) * DEMO_TOKEN_SCALE + BigInt(state.roundingMicroCents);
}

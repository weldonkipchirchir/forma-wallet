import { boundedJson } from './bounded-response';
import './asset-display.css';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icons = new Set(['ETH', 'BTC', 'SOL', 'TRX', 'POL', 'AVAX', 'USDT', 'USDC']);
/** Never infer an issuer's identity from an imported contract's symbol. */
export function assetLogo(symbol: string, verified = false) {
  const id = verified && icons.has(symbol) ? symbol.toLowerCase() : 'token';
  return `<img class="asset-logo" src="/assets/tokens/${id}.svg" width="36" height="36" alt="${id === 'token' ? 'Unverified token' : escape(symbol)} logo" loading="lazy">`;
}
export type AssetDisplayRow = { id: string; symbol: string; name: string; amount?: string; usd?: number; verified?: boolean };
export function assetTable(rows: AssetDisplayRow[], hidden: boolean, allowTokens = true) {
  const priced = rows.filter(row => row.usd !== undefined && Number.isFinite(row.usd) && row.usd >= 0);
  const total = priced.reduce((sum, row) => sum + row.usd!, 0);
  const dollars = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return `<div class="holdings-heading"><div><div class="eyebrow">ASSETS ON THIS NETWORK</div><h2>Your holdings</h2></div><div class="holdings-total"><strong>${hidden ? '••••••' : priced.length && Number.isFinite(total) ? dollars(total) : 'USD unavailable'}</strong><small>Hypothetical priced subtotal · ${priced.length}/${rows.length} assets priced</small></div></div><p class="hint">Test assets have no monetary value. Native USD references are Coinbase snapshots; refresh this view to update. Unverified token prices are unavailable, never assumed from their symbols. This list covers tracked assets, not every possible holding.</p><div class="holdings-columns" aria-hidden="true"><span>Asset</span><span>Amount</span><span>USD reference</span></div><div class="holdings-list">${rows.map(row => `<div class="holdings-row">${assetLogo(row.symbol, row.verified)}<div class="holdings-identity"><strong>${escape(row.symbol)}</strong><small>${escape(row.name)}</small></div><div class="holdings-amount"><small>Amount</small><strong>${hidden ? '••••••' : row.amount === undefined ? 'Unavailable' : escape(row.amount)}</strong></div><div class="holdings-value"><small>USD reference</small><strong>${hidden ? '••••••' : row.usd !== undefined && Number.isFinite(row.usd) && row.usd >= 0 ? dollars(row.usd) : 'Unavailable'}</strong></div></div>`).join('')}</div><div class="holdings-footer" ${allowTokens ? '' : 'hidden'}><span class="hint">Missing an asset? Find holdings or import its contract on Tokens.</span><button type="button" class="quiet" data-open-tokens>Manage tokens</button></div>`;
}
const products: Record<string, string> = { ETH: 'ETH-USD', BTC: 'BTC-USD', SOL: 'SOL-USD', TRX: 'TRX-USD', POL: 'POL-USD', AVAX: 'AVAX-USD' };
export async function readNativeReference(symbol: string, signal: AbortSignal): Promise<number> {
  const product = products[symbol];
  if (!product) throw new Error('No trusted native reference configured.');
  const response = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) throw new Error('USD reference unavailable.');
  const data = await boundedJson(response, 32000), price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid USD reference.');
  return price;
}

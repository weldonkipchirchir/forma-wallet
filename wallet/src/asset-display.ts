import { boundedJson } from './bounded-response';
import './asset-display.css';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const icons = new Set(['ETH', 'BTC', 'SOL', 'TRX', 'POL', 'AVAX', 'USDT', 'USDC']);
/** Never infer an issuer's identity from an imported contract's symbol. */
export function assetLogo(symbol: string, verified = false) {
  const id = verified && icons.has(symbol) ? symbol.toLowerCase() : 'token';
  return `<img class="asset-logo" src="/assets/tokens/${id}.svg" width="36" height="36" alt="${id === 'token' ? 'Unverified token' : escape(symbol)} logo" loading="lazy">`;
}
export type AssetDisplayRow = { id: string; symbol: string; name: string; amount?: string; usd?: number; verified?: boolean; kind?: 'token' };
export function referenceDollars(value: number) {
  if (!Number.isFinite(value) || value < 0) return 'Unavailable';
  if (value > 0 && value < 0.000001) return '<$0.000001';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2 });
}
export function assetTable(rows: AssetDisplayRow[], hidden: boolean, allowTokens = true, mode: 'testnet' | 'mainnet' = 'testnet') {
  const priced = rows.filter(row => row.usd !== undefined && Number.isFinite(row.usd) && row.usd >= 0);
  const total = priced.reduce((sum, row) => sum + row.usd!, 0);
  const rowMarkup = rows.map(row => {
    const zero = !hidden && row.amount !== undefined && /^0(?:\.0+)?$/.test(row.amount);
    const identity = !row.verified || row.kind === 'token' ? `<details class="holding-contract"><summary>Contract / mint</summary><code>${escape(row.id)}</code><small>${row.verified ? 'Issuer-listed mint' : 'Unverified identity'} · compare the full address with the issuer.</small></details>` : '<span class="holding-native">Native asset</span>';
    return `<div class="holdings-row" data-holding-row data-holding-search="${escape(`${row.symbol} ${row.name} ${row.id}`)}" data-holding-zero="${zero}">
      ${assetLogo(row.symbol, row.verified)}<div class="holdings-identity"><strong>${escape(row.symbol)}</strong><small>${escape(row.name)}</small>${identity}</div>
      <div class="holdings-amount"><small>Amount</small><strong>${hidden ? '••••••' : row.amount === undefined ? 'Unavailable' : escape(row.amount)}</strong></div>
      <div class="holdings-value"><small>USD reference</small><strong>${hidden ? '••••••' : row.usd === undefined ? 'Unavailable' : escape(referenceDollars(row.usd))}</strong></div></div>`;
  }).join('');
  return `<div data-holdings-table>
    <div class="holdings-heading"><div><div class="eyebrow">ASSETS ON THIS NETWORK</div><h2>Your holdings</h2></div><div class="holdings-total"><strong>${hidden ? '••••••' : priced.length && Number.isFinite(total) ? escape(referenceDollars(total)) : 'USD unavailable'}</strong><small>${mode === 'mainnet' ? 'Estimated' : 'Hypothetical'} priced subtotal · ${priced.length}/${rows.length} assets priced</small></div></div>
    <div class="holdings-toolbar"><label>Search assets<input type="search" data-holdings-search maxlength="100" placeholder="Name, symbol or contract" autocomplete="off"></label><label class="holdings-zero"><input type="checkbox" data-holdings-zero ${hidden ? 'disabled' : ''}> Hide zero balances</label><button type="button" class="text-button" data-holdings-reset hidden>Clear filters</button></div>
    <div class="holdings-meta"><span data-holdings-count role="status">${rows.length} of ${rows.length} assets shown</span><span>Subtotal covers all tracked assets with a price</span></div>
    <details class="holdings-explainer"><summary>About ${mode === 'mainnet' ? 'USD estimates' : 'testnet values'} and price coverage</summary><p class="hint">${mode === 'mainnet' ? 'Mainnet assets are real funds. USD estimates are indicative, not executable quotes or a guaranteed USDT peg.' : 'Test assets have no monetary value.'} USD references are Coinbase snapshots; reopen this view to update. Unverified token prices are unavailable, never assumed from their symbols. Tracking and discovery may miss holdings. Hide-zero filtering is disabled while balances are hidden.</p></details>
    <div class="holdings-columns" aria-hidden="true"><span>Asset</span><span>Amount</span><span>USD reference</span></div><div class="holdings-list">${rowMarkup}</div>
    <div class="holdings-empty" data-holdings-empty ${rows.length ? 'hidden' : ''}><strong>No matching assets</strong><p>Clear your filters or use Tokens to find and import holdings on this network.</p></div>
    <div class="holdings-footer" ${allowTokens ? '' : 'hidden'}><span class="hint">Missing an asset? Find holdings or import its contract on Tokens.</span><button type="button" class="quiet" data-open-tokens>Manage tokens</button></div></div>`;
}
const products: Record<string, string> = { ETH: 'ETH-USD', BTC: 'BTC-USD', SOL: 'SOL-USD', TRX: 'TRX-USD', POL: 'POL-USD', AVAX: 'AVAX-USD', USDT: 'USDT-USD' };
export async function readNativeReference(symbol: string, signal: AbortSignal): Promise<number> {
  const product = products[symbol];
  if (!product) throw new Error('No trusted native reference configured.');
  const response = await fetch(`https://api.exchange.coinbase.com/products/${product}/ticker`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) throw new Error('USD reference unavailable.');
  const data = await boundedJson(response, 32000), price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid USD reference.');
  return price;
}

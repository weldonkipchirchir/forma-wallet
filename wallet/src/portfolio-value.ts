import { formatEther } from 'ethers';
import type { Activity } from './activity';

export function costBasis(records: Activity[], address: string, balance: bigint, prices: Map<string, number>) {
  let quantity = 0, basis = 0;
  const ordered = records.filter(t => t.status === 'confirmed').sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const t of ordered) {
    const amount = Number(formatEther(t.value));
    const incoming = t.to.toLowerCase() === address.toLowerCase();
    const outgoing = t.from.toLowerCase() === address.toLowerCase();
    if (incoming && !outgoing && amount > 0) {
      const price = prices.get(t.id);
      if (!price || !Number.isFinite(price) || price <= 0) return null;
      quantity += amount; basis += amount * price;
    } else if (outgoing && !incoming && amount > 0) {
      if (amount > quantity + 1e-10) return null;
      basis *= Math.max(0, quantity - amount) / quantity;
      quantity = Math.max(0, quantity - amount);
    }
  }
  const held = Number(formatEther(balance));
  if (held > quantity + 1e-8 || (held > 0 && quantity <= 0)) return null;
  return { held, average: quantity > 0 ? basis / quantity : 0, basis: quantity > 0 ? held * basis / quantity : 0 };
}

const cache = new Map<number, number>();
async function request(path: string, signal: AbortSignal) {
  const result = await fetch(`https://api.exchange.coinbase.com/products/ETH-USD/${path}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!result.ok) throw new Error('USD price provider unavailable or rate-limited. Try refreshing later.');
  return result.json();
}
export async function currentUSD(signal: AbortSignal) {
  const data = await request('ticker', signal);
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid USD price response.');
  return price;
}
export async function depositUSD(timestamp: string, signal: AbortSignal) {
  const minute = Math.floor(Date.parse(timestamp) / 60000) * 60;
  if (cache.has(minute)) return cache.get(minute)!;
  const rows = await request(`candles?granularity=60&start=${new Date(minute * 1000).toISOString()}&end=${new Date((minute + 60) * 1000).toISOString()}`, signal);
  // Coinbase candle order: time, low, high, open, close, volume.
  const row = Array.isArray(rows) ? rows.find(r => Array.isArray(r) && Number(r[0]) === minute) : null;
  const price = Number(row?.[3]);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Historical price unavailable for this deposit minute.');
  cache.set(minute, price);
  if (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return price;
}

export function mountPortfolioValue(host: HTMLElement, records: Activity[], address: string, balance: bigint | null, hidden: () => boolean) {
  const abort = new AbortController();
  const deposits = records.filter(t => t.status === 'confirmed' && t.to.toLowerCase() === address.toLowerCase() && t.from.toLowerCase() !== address.toLowerCase() && BigInt(t.value) > 0n).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const prices = new Map<string, number>();
  let price: number | null = null;
  let updated = 0;
  let disposed = false;
  let running = false;
  let historicalError = false;
  const $ = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  const dollars = (value: number) => hidden() ? '••••••' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  function paint() {
    if (disposed) return;
    $('portfolio-usd').textContent = price && balance != null ? dollars(Number(formatEther(balance)) * price) : 'Loading USD price…';
    const basis = balance == null ? null : costBasis(records, address, balance, prices);
    if (price && basis && basis.basis > 0 && deposits.length <= 200) {
      const profit = basis.held * price - basis.basis;
      const pct = profit / basis.basis * 100;
      $('portfolio-pnl').textContent = hidden() ? '••••••' : `${profit >= 0 ? '+' : ''}${dollars(profit)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
      $('portfolio-pnl').className = profit >= 0 ? 'market-up' : 'market-down';
      $('portfolio-basis').textContent = `Remaining estimated basis: ${dollars(basis.basis)} · Average deposit ETH/USD: ${dollars(basis.average)}`;
    } else {
      $('portfolio-pnl').textContent = deposits.length ? 'Unavailable until history and deposit prices are complete' : 'No confirmed deposits loaded';
      $('portfolio-basis').textContent = 'Load older Activity records and refresh to extend the estimate.';
    }
    $('portfolio-since').textContent = deposits.length ? `Tracked since ${new Date(deposits[0].timestamp).toLocaleString()} · earliest loaded deposit` : 'No deposit date available';
    $('portfolio-price-source').textContent = updated ? `Coinbase ETH/USD · updated ${new Date(updated).toLocaleTimeString()} · 30s refresh${Date.now() - updated > 60000 ? ' · STALE' : ''}${historicalError ? ' · Some deposit prices unavailable' : ''}` : 'Connecting to Coinbase ETH/USD…';
    const table = $('portfolio-deposit-history'); table.replaceChildren();
    for (const t of deposits.slice(-25).reverse()) {
      const row = document.createElement('div'); row.className = 'deposit-value-row';
      const amount = Number(formatEther(t.value)), entry = prices.get(t.id);
      for (const text of [new Date(t.timestamp).toLocaleString(), hidden() ? '•••• ETH' : `${formatEther(t.value)} ETH`, entry ? `${dollars(amount * entry)} at deposit` : 'Deposit price unavailable', price ? `${dollars(amount * price)} now (reference)` : 'Current price unavailable']) { const cell = document.createElement('span'); cell.textContent = text; row.append(cell); }
      table.append(row);
    }
    if (!deposits.length) table.textContent = 'No confirmed incoming deposits in loaded history.';
  }
  async function tick() {
    if (disposed || running || document.hidden) return;
    running = true;
    try { price = await currentUSD(abort.signal); updated = Date.now(); paint(); }
    catch (e) { if (!disposed) { paint(); $('portfolio-price-source').textContent = `${e instanceof Error ? e.message : 'USD feed unavailable.'} ${updated ? 'Previous quote is stale.' : ''}`; } }
    finally { running = false; }
  }
  async function historyPrices() {
    for (const t of deposits.slice(0, 200)) {
      if (disposed) return;
      try { prices.set(t.id, await depositUSD(t.timestamp, abort.signal)); } catch { historicalError = true; }
      paint();
    }
  }
  host.addEventListener('portfolio-privacy-change', paint);
  paint(); void tick(); void historyPrices();
  const timer = setInterval(() => { paint(); void tick(); }, 30000);
  return () => { disposed = true; abort.abort(); clearInterval(timer); host.removeEventListener('portfolio-privacy-change', paint); };
}

import { createChart, CandlestickSeries, HistogramSeries, ColorType, type UTCTimestamp } from 'lightweight-charts';
import { ranges, marketRequest, parseCandles, percentageChange, type Candle } from './market-data';

export function marketMarkup() {
  return `<section id="market-panel" class="card market-panel"><div class="section-heading"><div><div class="eyebrow">SPOT MARKET · ETH / USDT</div><h2>Ethereum market</h2></div><span id="market-state" class="pill">Connecting</span></div>
  <div class="market-price-row"><strong id="market-price">— <small>USDT</small></strong><span id="market-day-change">24h change —</span></div>
  <p class="market-disclaimer">Real ETH market data, separate from your Sepolia test wallet. Test ETH has no monetary value. ALL starts at Binance’s earliest ETH/USDT candle, not Ethereum’s network launch.</p>
  <div class="market-changes">${ranges.map(r => `<div><span>${r.label}</span><strong data-market-change="${r.label}">—</strong></div>`).join('')}</div>
  <div class="market-controls"><div class="filter-tabs" aria-label="Chart history range">${ranges.map(r => `<button data-market-range="${r.label}" aria-pressed="${r.label === '24H'}" class="${r.label === '24H' ? 'is-active' : ''}">${r.label}</button>`).join('')}</div><button id="market-fit" class="quiet">Reset chart</button></div>
  <div id="market-ohlc" class="market-ohlc" aria-live="off">Loading candles…</div><div id="market-chart" role="img" aria-label="Interactive Ethereum USDT candlestick chart. Scroll to zoom, drag to pan, hover for OHLC values."></div>
  <div class="market-chart-meta"><span id="market-interval">15-minute candles · UTC</span><span>Green: close ≥ open · Red: close &lt; open</span></div>
  <p id="market-message" class="hint" role="status">Loading public market data…</p><div class="market-source"><span>Source: Binance spot ETHUSDT · Price refresh: 15s · Candles: 30s</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">Charts by TradingView ↗</a></div></section>`;
}

export function mountMarket(host: HTMLElement) {
  const abort = new AbortController();
  const $ = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  let selected: typeof ranges[number] = ranges[1];
  let lastPrice: number | null = null;
  let priceAt = 0;
  let benchmarksAt = 0;
  const benchmarks = new Map<string, number>();
  let candles: Candle[] = [];
  let requestId = 0;
  let priceBusy = false;
  let candleBusy = false;
  let benchmarkBusy = false;
  let disposed = false;
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const chart = createChart($('market-chart'), { autoSize: true, height: 340,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: dark() ? '#b8c8b0' : '#586b50', attributionLogo: true },
    grid: { vertLines: { color: dark() ? '#2c3b30' : '#edf1e8' }, horzLines: { color: dark() ? '#2c3b30' : '#edf1e8' } },
    rightPriceScale: { borderColor: '#74856555' }, timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#74856555' },
  });
  const series = chart.addSeries(CandlestickSeries, { upColor: '#39986b', downColor: '#d36c65', borderVisible: false, wickUpColor: '#39986b', wickDownColor: '#d36c65', priceFormat: { type: 'price', precision: 2, minMove: .01 } });
  const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
  volume.priceScale().applyOptions({ scaleMargins: { top: .85, bottom: 0 }, visible: false });
  series.priceScale().applyOptions({ scaleMargins: { top: .08, bottom: .2 } });
  const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function change(el: HTMLElement, n: number) { el.textContent = `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`; el.classList.toggle('market-up', n >= 0); el.classList.toggle('market-down', n < 0); }
  function showOHLC(c?: Candle) {
    if (!c) return;
    $('market-ohlc').textContent = `${new Date(c.time * 1000).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC · O ${money(c.open)}  H ${money(c.high)}  L ${money(c.low)}  C ${money(c.close)} · Vol ${c.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })} ETH`;
  }
  chart.subscribeCrosshairMove(event => { showOHLC(candles.find(c => c.time === event.time) ?? candles.at(-1)); });
  function updateChanges() {
    if (lastPrice == null) return;
    host.querySelectorAll<HTMLElement>('[data-market-change]').forEach(el => { const base = benchmarks.get(el.dataset.marketChange!); if (base) change(el, percentageChange(lastPrice!, base)); else { el.textContent = '—'; el.classList.remove('market-up', 'market-down'); } });
  }
  function status(message?: string) {
    if (disposed) return;
    const stale = !priceAt || Date.now() - priceAt > 45000;
    $('market-state').textContent = stale ? 'Offline / stale' : 'Live · 15s updates';
    if (message) $('market-message').textContent = message;
    else if (priceAt) $('market-message').textContent = `Price updated ${new Date(priceAt).toLocaleTimeString()}. Changes compare current price with minute-open prices near each lookback; ALL uses the earliest available monthly open. The latest candle is still forming.`;
  }
  async function prices() {
    if (priceBusy || disposed || document.hidden) return;
    priceBusy = true;
    try {
      const data = await marketRequest('ticker/24hr?symbol=ETHUSDT', abort.signal);
      if (disposed) return;
      const price = Number(data.lastPrice), day = Number(data.priceChangePercent);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(day)) throw new Error('Invalid market price response.');
      lastPrice = price; priceAt = Date.now();
      $('market-price').replaceChildren(document.createTextNode(`${money(price)} `));
      const unit = document.createElement('small'); unit.textContent = 'USDT'; $('market-price').append(unit);
      change($('market-day-change'), day); $('market-day-change').append(' · 24h exchange change');
      updateChanges(); status();
    } catch (e) { if (!disposed) status(`${e instanceof Error ? e.message : 'Market unavailable.'} Retained prices may be stale. Retrying automatically.`); }
    finally { priceBusy = false; }
  }
  async function comparisons() {
    if (benchmarkBusy || disposed || document.hidden || Date.now() - benchmarksAt < 60000) return;
    benchmarkBusy = true;
    const now = Date.now();
    const results = await Promise.allSettled(ranges.map(async r => {
      const time = Math.floor((now - r.hours * 3600000) / 60000) * 60000;
      const query = r.label === 'ALL' ? 'klines?symbol=ETHUSDT&interval=1M&startTime=0&limit=1' : `klines?symbol=ETHUSDT&interval=1m&startTime=${time}&endTime=${time + 59999}&limit=1`;
      const rows = parseCandles(await marketRequest(query, abort.signal));
      if (!rows[0]) throw new Error('Comparison unavailable.');
      return [r.label, rows[0].open] as const;
    }));
    if (!disposed) {
      results.forEach((r, index) => { if (r.status === 'fulfilled') benchmarks.set(...r.value); else benchmarks.delete(ranges[index].label); });
      benchmarksAt = now; updateChanges();
      if (results.some(r => r.status === 'rejected')) status('Some lookback changes are unavailable. Retrying in one minute.');
    }
    benchmarkBusy = false;
  }
  async function loadCandles(fit = false) {
    if (disposed || document.hidden || (candleBusy && !fit)) return;
    candleBusy = true;
    const revision = ++requestId;
    const range = selected;
    if (fit) $('market-ohlc').textContent = 'Loading selected range…';
    try {
      const rows = parseCandles(await marketRequest(`klines?symbol=ETHUSDT&interval=${range.interval}&limit=${range.limit}${range.label === 'ALL' ? '&startTime=0' : ''}`, abort.signal));
      if (disposed || revision !== requestId) return;
      if (!rows.length) throw new Error('No candles returned.');
      candles = rows;
      series.setData(rows.map(c => ({ ...c, time: c.time as UTCTimestamp })));
      volume.setData(rows.map(c => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? '#39986b55' : '#d36c6555' })));
      if (fit) chart.timeScale().fitContent();
      $('market-interval').textContent = range.label === 'ALL' ? `Monthly candles · Since ${new Date(rows[0].time * 1000).toLocaleDateString('en-GB', { timeZone: 'UTC' })} · Binance ETH/USDT listing · UTC` : `${range.interval} candles · ${range.label} view · UTC`;
      showOHLC(rows.at(-1));
    } catch (e) {
      if (!disposed && revision === requestId) { if (fit) { series.setData([]); volume.setData([]); candles = []; } $('market-ohlc').textContent = 'Candles unavailable. Try another range or retry shortly.'; status(e instanceof Error ? e.message : 'Chart unavailable.'); }
    } finally { if (revision === requestId) candleBusy = false; }
  }
  host.querySelectorAll<HTMLButtonElement>('[data-market-range]').forEach(button => button.onclick = () => {
    selected = ranges.find(r => r.label === button.dataset.marketRange)!;
    host.querySelectorAll<HTMLButtonElement>('[data-market-range]').forEach(b => { b.classList.toggle('is-active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    void loadCandles(true);
  });
  $('market-fit').onclick = () => chart.timeScale().fitContent();
  const observer = new MutationObserver(() => chart.applyOptions({ layout: { textColor: dark() ? '#b8c8b0' : '#586b50' }, grid: { vertLines: { color: dark() ? '#2c3b30' : '#edf1e8' }, horzLines: { color: dark() ? '#2c3b30' : '#edf1e8' } } }));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  void prices(); void comparisons(); void loadCandles(true);
  let tick = 0;
  const timer = setInterval(() => { status(); void prices(); void comparisons(); if (++tick % 2 === 0) void loadCandles(); }, 15000);
  return () => { disposed = true; abort.abort(); clearInterval(timer); observer.disconnect(); chart.remove(); };
}

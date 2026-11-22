import { addDemoCard, DEMO_ASSETS, demoCardsKey, demoCents, deleteDemoCard, freezeDemoCard, generateSandboxDetails, purchaseDemo, readDemoCards, SANDBOX_CARD_NUMBERS, type DemoAsset, type DemoCardState } from './demo-cards';
import { applyDemoConversion, DEMO_PRICES_CENTS, formatDemoTokens, loadSamplePortfolio, quoteDemoConversion, type DemoQuote } from './demo-card-funding';
import './demo-cards.css';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function mountDemoCards(host: HTMLElement, owner: string, current: () => boolean) {
  host.classList.add('demo-card-experience');
  let disposed = false, busy = false, selected = '', asset: DemoAsset = 'USDT', direction: DemoQuote['direction'] = 'token-to-card', quote: DemoQuote | undefined;
  let detailsTimer: ReturnType<typeof setTimeout> | undefined;
  const key = demoCardsKey(owner), live = () => !disposed && current() && host.isConnected;
  const load = () => readDemoCards(localStorage.getItem(key));
  const id = () => crypto.randomUUID();
  const field = (name: string) => host.querySelector<HTMLInputElement>(`#demo-${name}`)!.value;
  function message(text: string, error = false) {
    if (!live()) return;
    const target = host.querySelector<HTMLElement>('#demo-card-message');
    if (!target) return;
    target.textContent = text; target.classList.toggle('is-error', error); target.setAttribute('role', error ? 'alert' : 'status');
    if (error) { target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest' }); }
  }
  function controls() {
    host.setAttribute('aria-busy', String(busy));
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(control => { control.disabled = busy || control.dataset.blocked === 'true'; });
  }
  async function action(work: (state: DemoCardState) => DemoCardState) {
    if (!live() || busy) return;
    busy = true; controls();
    try {
      if (!navigator.locks) throw new Error('Use a current browser over HTTPS or localhost to coordinate demo changes across tabs.');
      await navigator.locks.request(`forma.demo-card-ledger:${owner.toLowerCase()}`, { ifAvailable: true }, lock => {
        if (!lock) throw new Error('Another tab is updating this demo portfolio. Try again after it finishes.');
        if (!live()) return;
        const state = work(load());
        if (!live()) return;
        // One durable write stores token debit, card credit, fees and history together.
        localStorage.setItem(key, JSON.stringify(state)); quote = undefined; paint();
      });
    } catch (error) { message((error as Error).message, true); }
    finally { if (live()) { busy = false; controls(); } }
  }
  function hideDetails() {
    clearTimeout(detailsTimer);
    host.querySelectorAll<HTMLElement>('[data-sandbox-details]').forEach(el => { el.hidden = true; });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-reveal]').forEach(el => { el.textContent = 'Show sandbox details'; el.setAttribute('aria-expanded', 'false'); });
  }
  function clearQuote() { quote = undefined; host.querySelector('#demo-conversion-review')?.replaceChildren(); }
  function showQuote() {
    if (!live()) return;
    try {
      quote = quoteDemoConversion(load(), { id: id(), cardId: selected, direction, asset, amount: field('convert-amount') });
      const q = quote, funding = direction === 'token-to-card';
      host.querySelector('#demo-conversion-review')!.innerHTML = `<div class="dc-quote"><span class="dc-kicker">REVIEW DEMO CONVERSION</span><h3>${funding ? 'Fund card' : 'Return to sample tokens'}</h3><dl><div><dt>You send</dt><dd>${funding ? `${formatDemoTokens(q.tokenUnits)} ${asset}` : usd(q.grossCents)}</dd></div><div><dt>Demo fee · 1%</dt><dd>${usd(q.feeCents)}</dd></div><div><dt>You receive</dt><dd>${funding ? usd(q.netCents) : `${formatDemoTokens(q.tokenUnits)} ${asset}`}</dd></div></dl><p>Fixed demo reference: 1 ${asset} = ${usd(DEMO_PRICES_CENTS[asset])}. Minor rounding is retained in the demo ledger. This is not a live or executable market quote. Expires in 60 seconds.</p><button id="demo-confirm-conversion" type="button" class="primary">Confirm demo conversion</button><button id="demo-cancel-conversion" type="button" class="quiet">Cancel</button></div>`;
      host.querySelector<HTMLButtonElement>('#demo-confirm-conversion')!.onclick = () => { const pending = quote; if (pending) void action(state => applyDemoConversion(state, pending)); };
      host.querySelector<HTMLButtonElement>('#demo-cancel-conversion')!.onclick = clearQuote;
    } catch (error) { clearQuote(); message((error as Error).message, true); }
  }
  function paint() {
    if (!live()) return;
    hideDetails();
    let state: DemoCardState;
    try { state = load(); } catch (error) { host.textContent = `${(error as Error).message} Your wallet funds are unaffected; demo data is separate.`; return; }
    if (!state.cards.some(card => card.id === selected)) selected = state.cards[0]?.id || '';
    const card = state.cards.find(card => card.id === selected);
    const available = state.cards.reduce((sum, item) => sum + item.balanceCents, 0);
    const activities = [
      ...state.purchases.map(item => ({ when: item.when, title: item.merchant, subtitle: 'Simulated purchase', amount: `−${usd(item.cents)}` })),
      ...state.conversions.map(item => ({ when: item.when, title: item.direction === 'token-to-card' ? `Fund card · ${item.asset}` : `Card → ${item.asset}`, subtitle: `Demo conversion · fee ${usd(item.feeCents)}`, amount: item.direction === 'token-to-card' ? `+${usd(item.netCents)}` : `−${usd(item.grossCents)}` })),
    ].sort((a, b) => Date.parse(b.when) - Date.parse(a.when)).slice(0, 20);
    host.innerHTML = `<section class="dc-demo-banner"><span class="dc-status-dot" aria-hidden="true"></span><div><strong>Sandbox experience</strong><p>All balances, prices and purchases below are synthetic. No real card is issued and no wallet tokens move.</p></div><span class="dc-pill">DEMO ONLY</span></section>
      <p id="demo-card-message" tabindex="-1" role="status">${state.sampleLoaded ? 'Sample portfolio loaded. Convert sample tokens to fund a card.' : 'Load the sample portfolio to explore funding. Your actual wallet balances stay separate.'}</p>
      <div class="dc-summary"><div><span class="dc-kicker">TOTAL DEMO CARD BALANCE</span><h2>${usd(available)}</h2><p>${state.cards.length} of 5 cards · account-specific demo</p></div><div class="dc-summary-meta"><span>Demo fees collected<strong>${usd(state.feesCents)}</strong></span><span>Actual funds used<strong>$0.00</strong></span></div></div>
      <div class="dc-workspace"><section class="dc-card-area"><div class="dc-section-title"><h2>Your cards</h2><span>${state.cards.length} / 5</span></div><div class="dc-card-tabs" role="group" aria-label="Choose demo card">${state.cards.map(item => `<button type="button" data-demo-select="${item.id}" aria-pressed="${selected === item.id}">${escape(item.label)} <small>••${item.lastFour}</small></button>`).join('')}</div>
      ${card ? `<article class="dc-payment-card ${card.frozen ? 'is-frozen' : ''}"><div class="dc-card-brand"><strong>forma<span> / DEMO</span></strong><span>${card.frozen ? 'Frozen' : 'Demo active'}</span></div><div class="dc-chip" aria-hidden="true">▦</div><p class="dc-pan">•••• •••• •••• ${card.lastFour}</p><div class="dc-card-bottom"><strong>${escape(card.label)}</strong><span>${card.details ? `${String(card.details.expiryMonth).padStart(2, '0')}/${String(card.details.expiryYear).slice(-2)}` : 'Generate details'}</span></div><div class="dc-card-balance"><span>Available demo USD<strong>${usd(card.balanceCents)}</strong></span><span>Spent / total limit<strong>${usd(card.spentCents)} / ${usd(card.limitCents)}</strong></span></div></article><div class="dc-card-tools"><button type="button" class="primary" id="demo-focus-funding">Fund card</button><button type="button" class="quiet" data-demo-freeze="${card.id}">${card.frozen ? 'Unfreeze' : 'Freeze'}</button>${card.details ? `<button type="button" class="quiet" data-demo-reveal="${card.id}" aria-expanded="false">Show sandbox details</button>` : `<button type="button" class="quiet" id="demo-generate-details">Generate sandbox details</button>`}<button type="button" class="dc-link" data-demo-delete="${card.id}">Delete</button></div>
      ${card.details ? `<div class="dc-sandbox-details" data-sandbox-details="${card.id}" hidden><strong>Public sandbox test details · Not a payment card</strong><dl><div><dt>Test number</dt><dd>${SANDBOX_CARD_NUMBERS[card.details.panIndex].replace(/(.{4})/g, '$1 ').trim()}</dd></div><div><dt>Demo expiry</dt><dd>${String(card.details.expiryMonth).padStart(2, '0')}/${String(card.details.expiryYear).slice(-2)}</dd></div><div><dt>Synthetic CVV</dt><dd>${card.details.demoCvv}</dd></div></dl><p>Uses a published Stripe testing number. Not connected to Stripe or a card issuer. Details hide after 20 seconds.</p></div>` : ''}` : '<div class="dc-empty"><span aria-hidden="true">▱</span><h3>Make room for everyday spending.</h3><p>Create your first demo card, then fund it from the sample portfolio.</p></div>'}
      <details class="dc-create" ${!card ? 'open' : ''}><summary>Create a demo card</summary><form id="demo-create"><label for="demo-label">Card label</label><input id="demo-label" maxlength="32" placeholder="Everyday card" required autocomplete="off"><label for="demo-limit">Total demo spending limit · USD</label><input id="demo-limit" inputmode="decimal" value="500.00" maxlength="8" required><button class="primary" data-blocked="${state.cards.length >= 5}" ${state.cards.length >= 5 ? 'disabled' : ''}>Generate demo card</button><p>Randomly selects a published sandbox test number and generates synthetic expiry/CVV. No arbitrary or real card credentials are created.</p></form></details></section>
      <section class="dc-funding-area"><div class="dc-section-title"><h2>Move your demo balance</h2><span class="dc-pill">NO REAL FUNDS</span></div><div class="dc-direction" role="group" aria-label="Conversion direction"><button type="button" data-demo-direction="token-to-card" aria-pressed="${direction === 'token-to-card'}">Token → card</button><button type="button" data-demo-direction="card-to-token" aria-pressed="${direction === 'card-to-token'}">Card → token</button></div><div class="dc-flow" role="img" aria-label="${direction === 'token-to-card' ? 'Sample token converts at a demo USD rate, then credits the demo card' : 'Demo card USD converts at a demo rate, then credits sample tokens'}"><span>${direction === 'token-to-card' ? 'Sample token' : 'Demo card'}</span><b aria-hidden="true">→</b><span>Demo USD quote</span><b aria-hidden="true">→</b><span>${direction === 'token-to-card' ? 'Demo card' : 'Sample token'}</span></div>
      <form id="demo-convert"><fieldset><legend>${direction === 'token-to-card' ? 'Pay with sample asset' : 'Receive sample asset'}</legend><div class="dc-asset-grid">${DEMO_ASSETS.map(value => `<button type="button" data-demo-asset="${value}" aria-pressed="${asset === value}"><strong>${value}</strong><small>${formatDemoTokens(state.reserve[value])} demo</small></button>`).join('')}</div></fieldset><label for="demo-convert-amount">${direction === 'token-to-card' ? `Amount in ${asset}` : 'Amount in demo USD'}</label><div class="dc-amount"><input id="demo-convert-amount" inputmode="decimal" maxlength="24" placeholder="0.00" required><span>${direction === 'token-to-card' ? asset : 'USD'}</span></div><div class="dc-quote-hint"><span>Fixed demo rate</span><strong>1 ${asset} = ${usd(DEMO_PRICES_CENTS[asset])}</strong></div><p>1% demo fee, minimum $0.01. Quotes expire after 60 seconds. These sample prices are illustrative, not live market rates or an actual stablecoin peg.</p><button class="primary" data-blocked="${!card || !state.sampleLoaded}" ${!card || !state.sampleLoaded ? 'disabled' : ''}>Review demo conversion</button></form><div id="demo-conversion-review"></div><button id="demo-load-sample" type="button" class="quiet" data-blocked="${state.sampleLoaded}" ${state.sampleLoaded ? 'disabled' : ''}>${state.sampleLoaded ? 'Sample portfolio loaded' : 'Load sample token balances'}</button><p class="dc-note">Loads imaginary USDT, ETH, SOL, BTC and TRX once for this account. No deposit address or approval is requested.</p></section></div>
      <div class="dc-lower"><section class="dc-panel"><div class="dc-section-title"><h2>Try a purchase</h2><span>Selected card</span></div><form id="demo-purchase"><label for="demo-merchant">Demo merchant</label><input id="demo-merchant" maxlength="60" placeholder="Sample coffee shop" required autocomplete="off"><label for="demo-amount">Purchase amount · USD</label><input id="demo-amount" inputmode="decimal" placeholder="5.00" maxlength="8" required><button class="quiet" data-blocked="${!card}" ${!card ? 'disabled' : ''}>Simulate purchase</button><p>Uses the funded demo card balance and spending limit. No payment is made.</p></form></section><section class="dc-panel dc-activity"><div class="dc-section-title"><h2>Recent activity</h2><span>Latest 20</span></div>${activities.map(item => `<div class="dc-activity-row"><span class="dc-activity-icon" aria-hidden="true">↗</span><div><strong>${escape(item.title)}</strong><small>${escape(item.subtitle)} · ${escape(new Date(item.when).toLocaleString())}</small></div><b>${escape(item.amount)}</b></div>`).join('') || '<p class="dc-note">Your funding, conversions and simulated purchases will appear here.</p>'}</section></div>`;
    host.querySelector<HTMLFormElement>('#demo-create')!.onsubmit = event => { event.preventDefault(); const label = field('label'), limit = field('limit'), cardId = id(), random = [...crypto.getRandomValues(new Uint32Array(3))]; void action(value => { const next = generateSandboxDetails(addDemoCard(value, label, demoCents(limit), cardId, '0000'), cardId, random); selected = cardId; return next; }); };
    host.querySelector<HTMLFormElement>('#demo-purchase')!.onsubmit = event => { event.preventDefault(); const cardId = selected, merchant = field('merchant'), amount = field('amount'), purchaseId = id(); void action(value => purchaseDemo(value, cardId, merchant, demoCents(amount), purchaseId)); };
    host.querySelector<HTMLFormElement>('#demo-convert')!.onsubmit = event => { event.preventDefault(); showQuote(); };
    host.querySelector<HTMLInputElement>('#demo-convert-amount')!.oninput = clearQuote;
    host.querySelector<HTMLButtonElement>('#demo-load-sample')!.onclick = () => { void action(loadSamplePortfolio); };
    host.querySelectorAll<HTMLButtonElement>('[data-demo-select]').forEach(button => button.onclick = () => { selected = button.dataset.demoSelect!; quote = undefined; paint(); });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-asset]').forEach(button => button.onclick = () => { asset = button.dataset.demoAsset as DemoAsset; quote = undefined; paint(); });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-direction]').forEach(button => button.onclick = () => { direction = button.dataset.demoDirection as DemoQuote['direction']; quote = undefined; paint(); });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-freeze]').forEach(button => button.onclick = () => { void action(value => freezeDemoCard(value, button.dataset.demoFreeze!)); });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-delete]').forEach(button => button.onclick = () => { void action(value => deleteDemoCard(value, button.dataset.demoDelete!)); });
    host.querySelector<HTMLButtonElement>('#demo-generate-details')?.addEventListener('click', () => { const cardId = selected, random = [...crypto.getRandomValues(new Uint32Array(3))]; void action(value => generateSandboxDetails(value, cardId, random)); });
    host.querySelector<HTMLButtonElement>('#demo-focus-funding')?.addEventListener('click', () => { direction = 'token-to-card'; quote = undefined; paint(); host.querySelector<HTMLInputElement>('#demo-convert-amount')?.focus(); });
    host.querySelectorAll<HTMLButtonElement>('[data-demo-reveal]').forEach(button => button.onclick = () => {
      if (!live()) return;
      const details = host.querySelector<HTMLElement>('[data-sandbox-details]')!;
      const show = details.hidden; hideDetails(); details.hidden = !show; button.textContent = show ? 'Hide sandbox details' : 'Show sandbox details'; button.setAttribute('aria-expanded', String(show));
      if (show) detailsTimer = setTimeout(hideDetails, 20_000);
    });
    controls();
  }
  const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) { quote = undefined; paint(); } };
  const hidden = () => { if (document.hidden) hideDetails(); };
  window.addEventListener('storage', changed); document.addEventListener('visibilitychange', hidden); paint();
  return () => { hideDetails(); disposed = true; quote = undefined; window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', hidden); host.replaceChildren(); };
}

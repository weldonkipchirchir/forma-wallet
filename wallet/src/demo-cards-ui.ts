import { addDemoCard, demoCardsKey, demoCents, deleteDemoCard, freezeDemoCard, purchaseDemo, readDemoCards, type DemoCardState } from './demo-cards';
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export function mountDemoCards(host: HTMLElement, owner: string, current: () => boolean) {
  let disposed = false;
  const key = demoCardsKey(owner), live = () => !disposed && current() && host.isConnected;
  const load = () => readDemoCards(localStorage.getItem(key));
  const id = () => crypto.randomUUID();
  const field = (name: string) => host.querySelector<HTMLInputElement>(`#demo-${name}`)!.value;
  const action = (work: (state: DemoCardState) => DemoCardState) => {
    if (!live()) return;
    try { const state = work(load()); if (!live()) return; localStorage.setItem(key, JSON.stringify(state)); paint(); }
    catch (error) { const message = host.querySelector<HTMLElement>('#demo-card-message')!; message.textContent = (error as Error).message; message.setAttribute('role', 'alert'); message.focus(); }
  };
  function paint() {
    if (!live()) return;
    let state: DemoCardState;
    try { state = load(); } catch (error) { host.textContent = `${(error as Error).message} Your wallet funds are unaffected; demo data is separate.`; return; }
    host.innerHTML = `<div class="demo-card-disclaimer"><strong>Demo only · No real payments</strong><p>Explore card controls with synthetic USD. These are not issued payment cards. They have no usable card number, expiry or CVV, cannot be added to Apple/Google Pay, and cannot spend crypto or money.</p></div>
      <p id="demo-card-message" class="hint" tabindex="-1" role="status">Demo cards are saved for this account on this browser.</p>
      <div class="demo-card-grid">${state.cards.map(card => `<article class="demo-payment-card ${card.frozen ? 'is-frozen' : ''}"><div class="demo-card-top"><strong>forma <small>DEMO</small></strong><span>${card.frozen ? 'Frozen' : 'Demo active'}</span></div><div class="demo-card-chip" aria-hidden="true">◈</div><p class="demo-card-digits">•••• •••• •••• ${card.lastFour}</p><h2>${escape(card.label)}</h2><div class="demo-card-limits"><span>Simulated spend<strong>${usd(card.spentCents)}</strong></span><span>Total demo limit<strong>${usd(card.limitCents)}</strong></span></div><div class="demo-card-actions"><button type="button" data-demo-freeze="${card.id}" class="quiet">${card.frozen ? 'Unfreeze demo card' : 'Freeze demo card'}</button><button type="button" data-demo-delete="${card.id}" class="quiet">Delete demo card</button></div></article>`).join('') || '<div class="empty"><h2>Your first demo card</h2><p>Create a synthetic card to explore spending limits and freeze controls.</p></div>'}</div>
      <div class="wallet-grid demo-card-forms"><section class="card"><h2>Create a demo card</h2><form id="demo-create"><label for="demo-label">Card label</label><input id="demo-label" maxlength="32" placeholder="Travel demo" required autocomplete="off"><label for="demo-limit">Total demo spending limit (USD)</label><input id="demo-limit" inputmode="decimal" value="500.00" required maxlength="8"><p class="hint">This limit is imaginary and does not reflect a wallet balance or credit line. Up to five cards per account.</p><button class="primary" ${state.cards.length >= 5 ? 'disabled' : ''}>Create demo card</button></form></section>
      <section class="card"><h2>Simulate a purchase</h2><form id="demo-purchase"><label for="demo-card-choice">Demo card</label><select id="demo-card-choice" required><option value="">Choose a card</option>${state.cards.map(card => `<option value="${card.id}">${escape(card.label)} · ${card.lastFour}${card.frozen ? ' · frozen' : ''}</option>`).join('')}</select><label for="demo-merchant">Demo merchant label</label><input id="demo-merchant" maxlength="60" placeholder="Sample coffee shop" required autocomplete="off"><label for="demo-amount">Demo purchase amount (USD)</label><input id="demo-amount" inputmode="decimal" placeholder="5.00" maxlength="8" required><button class="quiet" ${!state.cards.length ? 'disabled' : ''}>Simulate purchase</button><p class="hint">No payment is made and no external service is contacted.</p></form></section></div>
      <section class="card demo-card-history"><h2>Demo purchase activity</h2>${state.purchases.map(item => `<div class="history-row"><div><strong>${escape(item.merchant)}</strong><p>${escape(new Date(item.when).toLocaleString())} · simulated</p></div><strong>−${usd(item.cents)}</strong></div>`).join('') || '<p>No simulated purchases yet.</p>'}<p class="hint">Latest 50 demo purchases. Real issuance needs a partnered issuer, eligibility checks, a secure backend and issuer-controlled card-data handling.</p></section>`;
    host.querySelector<HTMLFormElement>('#demo-create')!.onsubmit = event => { event.preventDefault(); action(state => addDemoCard(state, field('label'), demoCents(field('limit')), id(), String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0'))); };
    host.querySelector<HTMLFormElement>('#demo-purchase')!.onsubmit = event => { event.preventDefault(); action(state => purchaseDemo(state, field('card-choice'), field('merchant'), demoCents(field('amount')), id())); };
    host.querySelectorAll<HTMLButtonElement>('[data-demo-freeze]').forEach(button => button.onclick = () => action(state => freezeDemoCard(state, button.dataset.demoFreeze!)));
    host.querySelectorAll<HTMLButtonElement>('[data-demo-delete]').forEach(button => button.onclick = () => action(state => deleteDemoCard(state, button.dataset.demoDelete!)));
  }
  const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) paint(); };
  window.addEventListener('storage', changed); paint();
  return () => { disposed = true; window.removeEventListener('storage', changed); host.replaceChildren(); };
}

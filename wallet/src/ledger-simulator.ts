// UI rehearsal only: no device, provider, signer, keys or persistent storage.
export type DemoState = 'disconnected' | 'connected' | 'reviewing' | 'approved' | 'rejected';
export type DemoAction = 'connect' | 'review' | 'approve' | 'reject' | 'disconnect';
export function demoTransition(state: DemoState, action: DemoAction): DemoState {
  if (action === 'disconnect') return 'disconnected';
  if (action === 'connect' && state === 'disconnected') return 'connected';
  if (action === 'review' && ['connected', 'approved', 'rejected'].includes(state)) return 'reviewing';
  if (state === 'reviewing' && action === 'approve') return 'approved';
  if (state === 'reviewing' && action === 'reject') return 'rejected';
  return state;
}
export function simulatorMarkup() {
  return `<details class="card ledger-demo" id="ledger-simulator"><summary><span class="demo-summary-icon" aria-hidden="true">◇</span><span>Try the Ledger simulator — no hardware needed<small>Practice connecting, reviewing and approving. Works on your phone.</small></span><span class="demo-badge">INTERACTIVE DEMO</span></summary><div class="demo-disclaimer"><strong>DEMO ONLY · No signing or broadcasting</strong><p>No device permissions, keys or funds are used. This rehearses the interface; it does not test a physical Ledger.</p></div><div id="ledger-demo-content"></div></details>`;
}
export function mountSimulator(host: HTMLElement) {
  const content = host.querySelector<HTMLElement>('#ledger-demo-content')!;
  let state: DemoState = 'disconnected';
  const messages: Record<DemoState, string> = {
    disconnected: 'Simulator disconnected. Your real wallet is unaffected.',
    connected: 'Demo device connected. Account: DEMO ONLY — not a receiving address.',
    reviewing: 'Check the sample transfer below, then simulate approving or rejecting it on a device.',
    approved: 'Demo approval complete. Nothing was signed or sent. No transaction hash exists.',
    rejected: 'Demo request rejected. Nothing was signed or sent.',
  };
  function paint() {
    const complete = state === 'approved' || state === 'rejected';
    const step = state === 'disconnected' ? 0 : state === 'connected' ? 1 : 2;
    const title = { disconnected: 'Meet your practice device.', connected: 'Connected. Ready to review.', reviewing: 'Your approval is the final step.', approved: 'Approval rehearsed.', rejected: 'You stayed in control.' }[state];
    const screen = { disconnected: 'Ready to connect', connected: 'Demo account ready', reviewing: 'Review · 0.001 ETH', approved: 'Demo approved ✓', rejected: 'Demo rejected ×' }[state];
    content.innerHTML = `<ol class="demo-steps" aria-label="Simulator progress">${['Connect', 'Review', 'Decision'].map((label, index) => `<li class="${index === step ? 'current' : index < step ? 'done' : ''}" ${index === step ? 'aria-current="step"' : ''}><span>${index < step ? '✓' : index + 1}</span>${label}</li>`).join('')}</ol>
      <div class="demo-grid"><div class="demo-device-panel"><span class="demo-badge">VIRTUAL DEVICE · SIMULATION</span><div class="demo-device" aria-hidden="true"><div class="demo-screen"><small>ETHEREUM SEPOLIA</small><strong>${screen}</strong><span>${state === 'reviewing' ? 'DEMO RECIPIENT' : 'PRACTICE MODE'}</span></div><i></i></div><p>A preview of a device approval flow.<br>No hardware connection is made.</p><span class="demo-state">${state === 'disconnected' ? '○ Disconnected' : complete ? '✓ Rehearsal complete' : '● Demo session active'}</span></div>
      <div class="demo-task"><h3>${title}</h3><p class="demo-status" role="status" aria-live="polite">${messages[state]}</p>
      ${state !== 'disconnected' ? '<dl class="demo-transfer"><div><dt>Network</dt><dd>Sepolia · testnet</dd></div><div><dt>Recipient</dt><dd>DEMO RECIPIENT</dd></div><div><dt>Amount</dt><dd>0.001 test ETH</dd></div><div><dt>Maximum fee</dt><dd>0.000042 test ETH</dd></div></dl><p class="demo-footnote">Fixed examples only. No real address, balance or network fee is queried.</p>' : '<p class="demo-explainer">Start a practice session, inspect a sample transfer, then choose to approve or reject. You can disconnect at any time.</p>'}
      <div class="demo-actions">
      ${state === 'disconnected' ? '<button type="button" class="primary" data-demo="connect">Simulate connection →</button>' : ''}
      ${['connected', 'approved', 'rejected'].includes(state) ? `<button type="button" class="primary" data-demo="review">${complete ? 'Practice another decision' : 'Review sample transfer →'}</button>` : ''}
      ${state === 'reviewing' ? '<button type="button" class="primary" data-demo="approve">Simulate approval ✓</button><button type="button" class="quiet" data-demo="reject">Simulate rejection ×</button>' : ''}
      ${state !== 'disconnected' ? '<button type="button" class="demo-disconnect" data-demo="disconnect">Disconnect simulator</button>' : ''}</div></div></div>`;
  }
  const click = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLButtonElement>('button[data-demo]')?.dataset.demo as DemoAction | undefined;
    if (action) { state = demoTransition(state, action); paint(); content.querySelector<HTMLButtonElement>('button[data-demo]')?.focus({ preventScroll: true }); }
  };
  const hidden = () => { if (document.hidden) { state = 'disconnected'; paint(); } };
  host.addEventListener('click', click);
  document.addEventListener('visibilitychange', hidden);
  paint();
  return () => { host.removeEventListener('click', click); document.removeEventListener('visibilitychange', hidden); state = 'disconnected'; content.replaceChildren(); };
}

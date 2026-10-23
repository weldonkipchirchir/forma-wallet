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
  return `<details class="card" id="ledger-simulator"><summary>Try the Ledger simulator — no hardware needed</summary><p><strong>DEMO ONLY · No signing or broadcasting</strong></p><p>Rehearse connection and device approval on a phone or computer. This is not a hardware wallet test. No keys, device permissions or funds are used.</p><div id="ledger-demo-content"></div></details>`;
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
    content.innerHTML = `<p role="status" aria-live="polite">${messages[state]}</p>
      ${state === 'reviewing' ? '<div class="ledger-address-box"><strong>Sample transfer · simulation</strong><p>From: DEMO ACCOUNT<br>To: DEMO RECIPIENT<br>Amount: 0.001 test ETH<br>Maximum fee: 0.000042 test ETH (fixed example)<br>Network: Ethereum Sepolia</p><p>No actual addresses, balances or network fees are queried.</p></div>' : ''}
      <div class="ledger-connection-actions">
      ${state === 'disconnected' ? '<button type="button" data-demo="connect">Simulate connection</button>' : ''}
      ${['connected', 'approved', 'rejected'].includes(state) ? '<button type="button" data-demo="review">Review sample transfer</button>' : ''}
      ${state === 'reviewing' ? '<button type="button" data-demo="approve">Simulate approval</button><button type="button" data-demo="reject">Simulate rejection</button>' : ''}
      ${state !== 'disconnected' ? '<button type="button" data-demo="disconnect">Disconnect simulator</button>' : ''}</div>`;
  }
  const click = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest<HTMLButtonElement>('button[data-demo]')?.dataset.demo as DemoAction | undefined;
    if (action) { state = demoTransition(state, action); paint(); }
  };
  const hidden = () => { if (document.hidden) { state = 'disconnected'; paint(); } };
  host.addEventListener('click', click);
  document.addEventListener('visibilitychange', hidden);
  paint();
  return () => { host.removeEventListener('click', click); document.removeEventListener('visibilitychange', hidden); state = 'disconnected'; content.replaceChildren(); };
}

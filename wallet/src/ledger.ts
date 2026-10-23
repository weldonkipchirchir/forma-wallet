import { formatEther, getAddress, keccak256, ZeroAddress, type JsonRpcProvider, type TransactionRequest } from 'ethers';
import { ledgerUnsigned, ledgerSigned, LEDGER_PATH } from './ledger-safety';
import { assertFreshReview, recipientNotice } from './transfer-safety';
import { affordable, requireSepolia, transferInput } from './wallet';
import { nativeJournalKey, parseJournal, type TokenSubmission } from './token-journal';
import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import { contactNotice, loadContacts } from './contacts';
import type { LedgerDevice } from './ledger-device';

export function ledgerMarkup() {
  return `<section id="ledger-panel" class="ledger-workspace"><div class="ledger-page-heading"><div><div class="eyebrow">HARDWARE WALLET</div><h1>Your keys. On your device.</h1><p>A direct connection to your Ledger. Your local wallet stays separate.</p></div><span class="ledger-network-pill"><i class="dot"></i> Experimental - Sepolia ETH only</span></div><div class="ledger-columns"><section class="card ledger-connect-card"><div class="ledger-step-label"><span>01</span> CONNECT & VERIFY</div><div class="ledger-device-art" aria-hidden="true"><div class="ledger-device"><span class="device-port"></span><div class="device-screen"><small>ETHEREUM</small><strong>Ready to connect</strong><span>&#9671;</span></div><span class="device-button"></span></div><div class="device-shadow"></div></div><h3>Meet your hardware wallet.</h3><p>Unlock your Ledger and open the Ethereum app. Then choose it in your browser and verify the address on its display.</p><button id="ledger-connect" class="primary" disabled>Connect Ledger & verify address</button><div class="ledger-connection-actions"><button id="ledger-back" class="text-button">Back to my wallet</button><button id="ledger-disconnect" class="text-button">Disconnect / cancel request</button></div><p id="ledger-notice" class="ledger-status" role="status" aria-live="polite"></p><div class="ledger-device-rule"><span aria-hidden="true">&#9671;</span><p>Never enter its recovery phrase or PIN here.<br>Do not enable blind signing.</p></div><details class="ledger-details"><summary>Browser support & connection details</summary><p>Use a desktop browser with WebHID over HTTPS or localhost. This in-app browser may not support device access.</p><p>Account path: <code>m/${LEDGER_PATH}</code><br>First Ethereum account only.</p><p>Ledger services may receive device or transaction metadata; RPC requests disclose the public address.</p></details></section><section class="card ledger-transfer-card"><div class="ledger-step-label"><span>02</span> REVIEW & APPROVE</div><h3>Send with confidence.</h3><p>Check the complete address, amount and maximum fee here, then approve them on your Ledger.</p><div class="ledger-address-box"><span class="ledger-field-caption">DEVICE ADDRESS</span><div id="ledger-account"><p>Connect your Ledger to display its address.</p></div></div><form id="ledger-send"><label class="check ledger-address-check"><input id="ledger-address-checked" type="checkbox" required disabled> I compared the full receiving address with my Ledger display.</label><label for="ledger-to">Ledger transfer recipient</label><input id="ledger-to" required autocomplete="off" placeholder="0x... recipient address" disabled><label for="ledger-amount">Sepolia ETH amount</label><div class="ledger-amount-field"><input id="ledger-amount" required inputmode="decimal" autocomplete="off" placeholder="0.00" disabled><span>ETH</span></div><p class="hint">Network fees are paid in Sepolia ETH. Test tokens have no monetary value.</p><button id="ledger-review-button" class="primary" disabled>Review Ledger transfer</button></form><div id="ledger-review"></div><div class="ledger-approval-note"><span aria-hidden="true">&#10003;</span><p>Your device has the final say.<br>No transaction is sent without its signature.</p></div></section></div><section class="card ledger-history-card"><div class="section-heading"><div><div class="eyebrow">AFTER YOU APPROVE</div><h3>Ledger ETH submissions</h3></div><button id="ledger-refresh" class="quiet" disabled>Refresh Ledger submissions</button></div><div id="ledger-submissions"><div class="ledger-empty"><span aria-hidden="true">&#8599;</span><p>Submitted transfers will appear here.<br>Connect your device to check its local history.</p></div></div></section><details class="ledger-details ledger-scope"><summary>What this version supports</summary><p>Plain Sepolia ETH transfers only. No token, contract, arbitrary message, typed-data or delegation signing is supported. Physical-device verification is still required before this integration can be considered validated.</p></details></section>`;

}
const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function mountLedger(host: HTMLElement, provider: JsonRpcProvider, back: () => void) {
  let disposed = false, busy = false, epoch = 0, operation = 0, address = '', prepared: TransactionRequest | undefined, reviewedAt = 0;
  let device: LedgerDevice | undefined, factory: typeof import('./ledger-device').createLedgerDevice | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const $ = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  const input = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
  const button = (id: string) => host.querySelector<HTMLButtonElement>(`#${id}`)!;
  const notice = (text: string) => { if (!disposed) $('ledger-notice').textContent = text; };
  function controls() {
    if (disposed) return;
    button('ledger-connect').disabled = !factory || busy || !!address;
    button('ledger-review-button').disabled = !address || busy;
    button('ledger-refresh').disabled = !address || busy;
    host.querySelectorAll<HTMLInputElement>('#ledger-send input').forEach(field => { field.disabled = busy || !address; });
  }
  function disconnect() {
    epoch++; operation++; clearTimeout(idle); device?.close(); device = undefined; address = ''; prepared = undefined; busy = false;
    if (!disposed) { $('ledger-account').innerHTML = '<p>Connect your Ledger to display its address.</p>'; $('ledger-review').replaceChildren(); $('ledger-submissions').replaceChildren(); input('ledger-address-checked').checked = false; notice('Ledger disconnected. Connect and verify its address again.'); controls(); }
  }
  const touch = () => { clearTimeout(idle); if (device) idle = setTimeout(disconnect, 300000); };
  const hidden = () => { if (document.hidden) disconnect(); };
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', disconnect);
  host.addEventListener('pointerdown', touch); host.addEventListener('keydown', touch);
  function rows() { try { return parseJournal(JSON.parse(localStorage.getItem(nativeJournalKey(address)) || '[]')); } catch { return []; } }
  function paint() {
    if (disposed || !address) return;
    $('ledger-submissions').innerHTML = rows().map(r => `<div class="tx"><div><strong>${formatEther(r.amount)} ETH - ${r.status}</strong><p>${escape(submissionDetail(r))}</p></div><a href="https://sepolia.etherscan.io/tx/${r.hash}" target="_blank" rel="noopener noreferrer">Check transaction</a></div>`).join('') || '<p>No locally recorded submissions for this device address.</p>';
  }
  async function run(work: () => Promise<void>) {
    if (busy || disposed) return; const running = ++operation; busy = true; controls();
    try { await work(); } catch (e) { if (!disposed && running === operation) notice(e instanceof Error ? e.message : 'Ledger request failed. Reconnect and review again.'); }
    finally { if (running === operation) { busy = false; controls(); touch(); } }
  }
  $('ledger-back').onclick = back;
  $('ledger-disconnect').onclick = disconnect;
  if (!window.isSecureContext || !('hid' in navigator)) notice('WebHID is unavailable in this browser. Open this wallet in a compatible desktop Chrome or Edge browser using the same localhost URL. Browser wallets are stored separately per browser. Never move a Ledger seed into this app.');
  else {
    notice('Loading Ledger support...');
    void import('./ledger-device').then(module => { if (!disposed) { factory = module.createLedgerDevice; controls(); notice('Ready. Click Connect, choose your Ledger, then approve address verification on its display.'); } }).catch(() => notice('Ledger support could not load. Check the application build and browser.'));
  }
  $('ledger-connect').onclick = () => void run(async () => {
    if (!factory) throw new Error('Ledger support unavailable.');
    const captured = ++epoch;
    const client = factory(notice, disconnect); device = client; touch();
    try {
    // Discovery starts in this user click, before awaiting an RPC request.
    await client.connect();
    requireSepolia((await provider.getNetwork()).chainId);
    const result = getAddress(await client.address());
    if (disposed || captured !== epoch) { client.close(); return; }
    address = result;
    $('ledger-account').innerHTML = `<h3>Verify this receiving address on your Ledger</h3><code>${address}</code><p>Ethereum Sepolia only. The local signing wallet has not been switched.</p>`;
    paint(); notice('Device address received. Compare every character with the Ledger display before continuing.');
    } catch (error) { if (device === client) { disconnect(); notice('Connection or address verification failed. Reconnect your Ledger and try again.'); } else client.close(); throw error; }
  });
  $('ledger-send').oninput = () => { epoch++; prepared = undefined; $('ledger-review').replaceChildren(); };
  $('ledger-send').onsubmit = event => { event.preventDefault(); void run(async () => {
    prepared = undefined; $('ledger-review').replaceChildren();
    if (!address || !device || !input('ledger-address-checked').checked) throw new Error('Connect and verify the device address first.');
    const captured = epoch, sender = address;
    const { to, value } = transferInput(input('ledger-to').value, input('ledger-amount').value);
    const warning = contactNotice(to, loadContacts(sender)) || recipientNotice(to, sender, []);
    requireSepolia((await provider.getNetwork()).chainId);
    const [gasLimit, fees, balance, nonce] = await Promise.all([provider.estimateGas({ from: sender, to, value }), provider.getFeeData(), provider.getBalance(sender), provider.getTransactionCount(sender, 'pending')]);
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Current network fees are unavailable.');
    affordable(value, gasLimit, fees.maxFeePerGas, balance);
    if (disposed || captured !== epoch || address !== sender) return;
    prepared = { to, value, nonce, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, type: 2, chainId: 11155111n, data: '0x' };
    ledgerUnsigned(prepared); reviewedAt = Date.now();
    $('ledger-review').innerHTML = `<div class="review"><strong>Review Ledger Sepolia transfer</strong><p>From: <code>${sender}</code></p><p>To: <code>${to}</code></p><p>Amount: ${formatEther(value)} ETH</p><p>Maximum fee: ${formatEther(gasLimit * fees.maxFeePerGas)} ETH</p><p>${escape(warning)}</p><p>Review expires after two minutes. Verify these details again on the device.</p><label class="check"><input id="ledger-approve" type="checkbox"> I verified the full recipient and Sepolia network.</label><button id="ledger-sign" class="primary">Review & approve on Ledger</button><button id="ledger-cancel-review" class="quiet">Cancel review</button></div>`;
    $('ledger-cancel-review').onclick = () => { epoch++; prepared = undefined; $('ledger-review').replaceChildren(); };
    $('ledger-sign').onclick = () => void run(async () => {
      if (!prepared || !device || !input('ledger-approve').checked) throw new Error('Review and acknowledge the recipient first.');
      assertFreshReview(reviewedAt);
      const request = prepared, client = device, version = epoch, owner = address;
      prepared = undefined; $('ledger-review').replaceChildren();
      const current = () => !disposed && epoch === version && address === owner && device === client;
      requireSepolia((await provider.getNetwork()).chainId);
      if (!current()) throw new Error('Ledger session changed. Nothing was broadcast.');
      const signature = await client.sign(ledgerUnsigned(request));
      const raw = ledgerSigned(request, signature, owner);
      assertFreshReview(reviewedAt);
      requireSepolia((await provider.getNetwork()).chainId);
      const row: TokenSubmission = { hash: keccak256(raw), contract: ZeroAddress, to: String(request.to), amount: String(request.value), decimals: 18, symbol: 'ETH', nonce: Number(request.nonce), timestamp: new Date().toISOString(), status: 'unknown' };
      await submitTracked(raw, row, update => {
        let existing: TokenSubmission[] = []; try { existing = parseJournal(JSON.parse(localStorage.getItem(nativeJournalKey(owner)) || '[]')); } catch { /* empty journal */ }
        localStorage.setItem(nativeJournalKey(owner), JSON.stringify([update, ...existing.filter(r => r.hash !== update.hash)].slice(0, 200))); if (current()) paint();
      }, bytes => provider.broadcastTransaction(bytes), () => { assertFreshReview(reviewedAt); return current(); });
      if (current()) notice('Ledger transfer submitted. Verify confirmation on the explorer before retrying.');
    });
  }); };
  $('ledger-refresh').onclick = () => void run(async () => {
    const captured = epoch, owner = address;
    requireSepolia((await provider.getNetwork()).chainId);
    const updated = await inspectSubmissions(rows(), { receipt: hash => provider.getTransactionReceipt(hash), height: () => provider.getBlockNumber(), transaction: hash => provider.getTransaction(hash), minedNonce: () => provider.getTransactionCount(owner, 'latest') });
    if (disposed || captured !== epoch || address !== owner) return;
    const changes = new Map(updated.map(r => [r.hash, r])); localStorage.setItem(nativeJournalKey(owner), JSON.stringify(rows().map(r => changes.get(r.hash) ?? r))); paint();
  });
  return () => { disposed = true; disconnect(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', disconnect); host.removeEventListener('pointerdown', touch); host.removeEventListener('keydown', touch); };
}

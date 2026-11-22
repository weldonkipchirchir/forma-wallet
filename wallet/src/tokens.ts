import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import { assertSepoliaNonceFree, retainSepoliaSubmission, strictSepoliaJournal, withSepoliaSendLock } from './sepolia-send';
import { contactOptions, contactNotice, loadContacts } from './contacts';
import { journalKey, parseJournal, type TokenSubmission } from './token-journal';
import { assertFreshReview, assertSignedMatchesReview, recipientNotice, safeTokenText } from './transfer-safety';
import { allowanceLabel, approvalWarning, approvalScanPage, APPROVAL_SCAN_LIMIT, cursorQuery, parseApprovalTransactions, revokeRequest, type ApprovalFinding } from './approvals';
import { boundedJson } from './bounded-response';
import { simulationFailure, tokenSimulation } from './simulation';
import { Contract, formatUnits, formatEther, keccak256, type JsonRpcProvider, type Wallet, type HDNodeWallet, type TransactionRequest } from 'ethers';
import { CHAIN_ID, requireSepolia, affordable } from './wallet';
import { ERC20_ABI, loadTokens, tokenKey, tokenAddress, tokenAmount, tokenInterface, parseTokenTransfers, type Token, type TokenTransfer } from './token-data';

const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function tokensMarkup() {
  return `<section id="tokens-panel" class="asset-workspace"><section class="card asset-inventory"><div class="section-heading"><div><div class="eyebrow">YOUR ASSETS · ETHEREUM SEPOLIA</div><h2>Token collection</h2></div><button id="tokens-refresh" class="quiet">Refresh tokens</button></div><p>Track ERC-20 tokens by their Sepolia contract address. Names and symbols are self-reported by contracts; verify the full address independently. Test token prices are unavailable.</p><details class="asset-import"><summary>＋ Add a token</summary><form id="token-import"><label for="token-contract">Token contract address</label><input id="token-contract" placeholder="0x…" required autocomplete="off"><button class="primary">Validate & add token</button></form><p class="hint">Verify the full Sepolia contract address independently.</p></details><p id="token-notice" role="status" aria-live="polite"></p><button id="tokens-hidden-toggle" class="quiet">Show hidden tokens</button><div id="token-list" class="asset-list"></div></section>
  <div class="portfolio-grid lower asset-transfer-grid"><section class="card"><h2>Send a token</h2><form id="token-send"><label for="token-select">Token</label><select id="token-select" required></select><label for="token-contact">Saved recipient (optional)</label><select id="token-contact"></select><label for="token-recipient">Recipient address</label><input id="token-recipient" required placeholder="0x…" autocomplete="off"><label for="token-amount">Token amount</label><input id="token-amount" required inputmode="decimal" placeholder="0.00" autocomplete="off"><p class="hint">Gas is paid in Sepolia ETH. This sends tokens directly; it does not create an allowance.</p><button class="primary">Review token transfer</button></form><div id="token-review"></div></section><section class="card asset-receive"><h2>Receive tokens</h2><p>Use your existing Ethereum Sepolia wallet address for all supported ERC-20 tokens.</p><code id="token-receive-address" class="token-address"></code><p class="hint">Choose Ethereum Sepolia at the sender. Importing a token only adds it to your display; you can receive before importing.</p><p>USD price and profit/loss: unavailable for these test tokens.</p></section></div>
  <section class="card approvals-card" id="approvals-panel"><div class="section-heading"><div><div class="eyebrow">PERMISSIONS · ETHEREUM SEPOLIA</div><h2>Token approvals</h2></div><button id="approvals-scan" class="quiet" type="button">Scan tracked tokens</button></div><p class="hint">Finds allowances created by this wallet in up to 200 recent outgoing indexed transactions, then checks each one on-chain. Revoking sends <code>approve(spender, 0)</code>: it moves no tokens but costs gas. This is basic <code>eth_call</code> revert detection, not PPOM-grade coverage or a complete allowance index.</p><p id="approval-notice" role="status" aria-live="polite"></p><div id="approval-list"></div><details class="asset-import"><summary>Check a specific spender</summary><form id="approval-check"><label for="approval-token">Token</label><select id="approval-token" required></select><label for="approval-spender">Spender address</label><input id="approval-spender" placeholder="0x…" required maxlength="42" autocomplete="off"><button class="primary" type="submit">Check allowance</button></form><div id="approval-check-result"></div></details><div id="approval-review"></div></section>
  <section class="card activity"><h2>Submitted token activity</h2><p class="hint">Locally recorded transfers and revocations, including uncertain broadcasts. Unknown does not mean failed. Check the explorer before retrying. Receipt status is supplied by the RPC.</p><div id="token-submissions"></div><div class="section-heading"><h2>Token transfer history</h2><button id="token-history-refresh" class="quiet">Refresh history</button></div><p class="hint">Indexed ERC-20 transfers for your tracked contracts. An indexer may lag. Open the explorer to verify confirmation.</p><div id="token-history"></div><button id="token-history-more" class="quiet" hidden>Load older token transfers</button></section></section>`;
}

export function mountTokens(host: HTMLElement, provider: JsonRpcProvider, wallet: Wallet | HDNodeWallet, isCurrent: () => boolean, hideBalance: () => boolean) {
  const abort = new AbortController();
  let disposed = false, working = false, revision = 0;
  let showHidden = false;
  let reviewedAt = 0;
  let tokens = loadTokens(wallet.address);
  let cursor: Record<string, string | number> | null = null;
  let transfers: TokenTransfer[] = [];
  let submissions: TokenSubmission[] = [];
  let activeApprovals: { token: Token; spender: string; value: bigint }[] = [];
  let approvalsScanned = false;
  let approvalPending: { token: Token; spender: string; current: bigint; tx: TransactionRequest } | null = null;
  let approvalReviewedAt = 0;
  try { submissions = parseJournal(JSON.parse(localStorage.getItem(journalKey(wallet.address)) || '[]')); } catch { /* no valid local journal */ }
  function saveSubmissions() { localStorage.setItem(journalKey(wallet.address), JSON.stringify(submissions)); }
  function paintSubmissions() {
    if (!valid()) return;
    $('token-submissions').innerHTML = submissions.map(r => {
      const approval = r.action === 'revoke' || r.action === 'approve';
      const label = r.action === 'revoke' ? `Revoke ${r.symbol} allowance` : r.action === 'approve' ? `Approve ${r.symbol}` : `${formatUnits(r.amount, r.decimals)} ${r.symbol}`;
      return `<div class="tx"><div><strong>${escape(label)}</strong><p>${r.status} &middot; ${escape(new Date(r.timestamp).toLocaleString())}</p><p>${escape(submissionDetail(r))}</p><p>${approval ? 'Spender' : 'Recipient'}: <code>${escape(r.to)}</code></p></div><a href="https://sepolia.etherscan.io/tx/${r.hash}" target="_blank" rel="noopener noreferrer">View transaction</a></div>`;
    }).join('') || '<p>No locally recorded token activity.</p>';
  }
  async function refreshSubmissions() {
    requireSepolia((await provider.getNetwork()).chainId);
    const updated = await inspectSubmissions(submissions, { receipt: hash => provider.getTransactionReceipt(hash), height: () => provider.getBlockNumber(), transaction: hash => provider.getTransaction(hash), minedNonce: () => provider.getTransactionCount(wallet.address, 'latest') });
    if (!valid()) return;
    let latest = submissions;
    try { latest = parseJournal(JSON.parse(localStorage.getItem(journalKey(wallet.address)) || '[]')); } catch { /* use in-memory records */ }
    const updates = new Map(updated.map(row => [row.hash, row]));
    submissions = latest.map(row => updates.get(row.hash) ?? row); saveSubmissions(); paintSubmissions(); paintApprovals();
  }
  function pendingRevoke(token: Token, spender: string) {
    return submissions.some(row => row.action === 'revoke' && row.contract.toLowerCase() === token.address.toLowerCase() && row.to.toLowerCase() === spender.toLowerCase() && (row.status === 'pending' || row.status === 'unknown'));
  }
  function approvalRow(finding: { token: Token; spender: string; value: bigint }) {
    return `<div class="token-row asset-row approval-row"><span class="asset-avatar" aria-hidden="true">◇</span><div class="asset-identity"><strong>${escape(finding.token.symbol)} allowance</strong><p>Spender: <code>${escape(finding.spender)}</code></p><p class="approval-warning">${escape(approvalWarning(finding.value, finding.token.decimals, finding.token.symbol, finding.spender))}</p></div><div class="token-row-value"><strong>${escape(allowanceLabel(finding.value, finding.token.decimals, finding.token.symbol))}</strong>${pendingRevoke(finding.token, finding.spender) ? '<p>Revocation submitted; waiting for a receipt. Scan again after confirmation.</p>' : `<button class="quiet" type="button" data-revoke-token="${finding.token.address}" data-revoke-spender="${finding.spender}">Review revocation</button>`}</div></div>`;
  }
  function paintApprovals() {
    if (!valid()) return;
    const list = $('approval-list');
    list.innerHTML = !tokens.length ? '<p>Track an ERC-20 token before scanning for approvals.</p>'
      : activeApprovals.length ? activeApprovals.map(approvalRow).join('')
      : approvalsScanned ? '<p>No active allowances found for tracked tokens in the scanned transactions. Older approvals may be outside the scan; use the spender check below.</p>'
      : '<p>No approval scan loaded. Scan tracked tokens or check a specific spender.</p>';
  }
  async function scanApprovals() {
    if (!tokens.length) throw new Error('Track a token before scanning for approvals.');
    activeApprovals = []; approvalsScanned = false; approvalPending = null; $('approval-review').replaceChildren();
    $('approval-list').innerHTML = '<p>Scanning recent indexed approvals…</p>';
    $('approval-notice').textContent = '';
    requireSepolia((await provider.getNetwork()).chainId);
    const found = new Map<string, ApprovalFinding>();
    let remaining = APPROVAL_SCAN_LIMIT;
    let next: Record<string, string> | null = null;
    for (let page = 0; page < 4 && remaining > 0; page++) {
      if (!valid()) return;
      const query = new URLSearchParams({ filter: 'from' });
      if (next) Object.entries(next).forEach(([key, value]) => query.set(key, value));
      const response = await fetch(`https://eth-sepolia.blockscout.com/api/v2/addresses/${wallet.address}/transactions?${query}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Approval discovery is unavailable. Check a spender manually or retry later.');
      const data = await boundedJson(response);
      if (!valid()) return;
      const batch = approvalScanPage(data?.items, remaining);
      remaining = batch.remaining;
      for (const finding of parseApprovalTransactions(batch.items, tokens, wallet.address)) {
        const key = `${finding.token.toLowerCase()}:${finding.spender.toLowerCase()}`;
        const previous = found.get(key);
        if (!previous || Date.parse(finding.timestamp) > Date.parse(previous.timestamp)) found.set(key, finding);
      }
      next = cursorQuery(data.next_page_params);
      if (!next) break;
    }
    const byAddress = new Map(tokens.map(token => [token.address.toLowerCase(), token]));
    let failed = 0;
    const verified: typeof activeApprovals = [];
    for (const finding of found.values()) {
      if (!valid()) return;
      const token = byAddress.get(finding.token.toLowerCase());
      if (!token) continue;
      try {
        const value = BigInt(await new Contract(token.address, ERC20_ABI, provider).allowance(wallet.address, finding.spender));
        if (value > 0n) verified.push({ token, spender: finding.spender, value });
      } catch { failed++; }
    }
    if (!valid()) return;
    activeApprovals = verified.sort((a, b) => a.token.symbol.localeCompare(b.token.symbol) || a.spender.localeCompare(b.spender));
    approvalsScanned = true; paintApprovals();
    $('approval-notice').textContent = verified.length
      ? `${verified.length} active token allowance${verified.length === 1 ? '' : 's'} found. Review each spender before revoking.`
      : failed ? `No active allowances verified; ${failed} on-chain allowance read${failed === 1 ? '' : 's'} failed. Check a spender manually or retry.`
      : 'No active allowances found for tracked tokens in the scanned transactions. Older approvals may be outside the scan; check a specific spender below.';
  }
  async function checkApproval() {
    const token = tokens.find(t => !t.hidden && t.address === field('approval-token'));
    if (!token) throw new Error('Choose a tracked token.');
    const spender = tokenAddress(field('approval-spender'));
    requireSepolia((await provider.getNetwork()).chainId);
    const value = BigInt(await new Contract(token.address, ERC20_ABI, provider).allowance(wallet.address, spender));
    if (!valid()) return;
    $('approval-check-result').innerHTML = value > 0n
      ? `<div class="approval-check"><strong>Current allowance: ${escape(allowanceLabel(value, token.decimals, token.symbol))}</strong><p class="approval-warning">${escape(approvalWarning(value, token.decimals, token.symbol, spender))}</p>${pendingRevoke(token, spender) ? '<p>Revocation submitted; waiting for a receipt. Scan again after confirmation.</p>' : '<button class="quiet" type="button" id="check-revoke">Review revocation</button>'}</div>`
      : `<p>No active allowance for ${escape(token.symbol)} to this spender.</p>`;
    const revoke = $('approval-check-result').querySelector<HTMLButtonElement>('#check-revoke');
    if (revoke) revoke.onclick = () => void run(() => prepareRevoke(token, spender), 'approval-notice');
  }
  async function prepareRevoke(token: Token, spender: string) {
    approvalPending = null; $('approval-review').replaceChildren();
    requireSepolia((await provider.getNetwork()).chainId);
    const contract = new Contract(token.address, ERC20_ABI, provider);
    const current = BigInt(await contract.allowance(wallet.address, spender));
    if (current === 0n) throw new Error('The on-chain allowance is already zero. Nothing to revoke.');
    const tx: TransactionRequest = { ...revokeRequest(token, spender), chainId: CHAIN_ID, type: 2 };
    let simulated: string;
    try { simulated = await provider.call({ ...tx, from: wallet.address }); }
    catch (error) { throw new Error(simulationFailure(error)); }
    if (tokenSimulation(simulated, 'approve') === 'rejected') throw new Error('The token rejected the simulated revocation (approve returned false). Nothing was signed.');
    const signer = wallet.connect(provider);
    const gasLimit = (await signer.estimateGas(tx)) * 120n / 100n;
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Network fee unavailable.');
    affordable(0n, gasLimit, fees.maxFeePerGas, await provider.getBalance(wallet.address));
    if (!valid()) return;
    approvalReviewedAt = Date.now();
    approvalPending = { token, spender, current, tx: { ...tx, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas } };
    $('approval-review').innerHTML = `<div class="review"><strong>Revoke token approval</strong><p>Token: ${escape(token.symbol)} (unverified)</p><code>${escape(token.address)}</code><p>Spender: <code>${escape(spender)}</code></p><p>Current allowance: ${escape(allowanceLabel(current, token.decimals, token.symbol))}</p><p>After revocation: <strong>0 ${escape(token.symbol)}</strong></p><p>Maximum gas fee: ${formatEther(gasLimit * fees.maxFeePerGas)} Sepolia ETH</p><p class="recipient-warning">${escape(approvalWarning(current, token.decimals, token.symbol, spender))}</p><p class="hint">Simulation: <code>approve(spender, 0)</code> passed basic eth_call revert detection. This does not prove the token will update its allowance correctly, and it is not a balance-change preview or PPOM-grade analysis.</p><p class="hint">Revoking this allowance does not affect other spenders or tokens. Review expires in 2 minutes.</p><label class="check"><input id="verify-approval-revoke" type="checkbox"> I verified the token contract, spender and Sepolia network.</label><button type="button" id="approval-confirm" class="primary">Confirm revocation</button><button type="button" id="approval-cancel-review" class="quiet">Keep allowance</button></div>`;
    $('approval-cancel-review').onclick = () => { approvalPending = null; $('approval-review').replaceChildren(); };
    $('approval-confirm').onclick = () => void run(() => withSepoliaSendLock(wallet.address, async () => {
      if (!approvalPending) throw new Error('Review the revocation again.');
      assertFreshReview(approvalReviewedAt);
      if (!(host.querySelector('#verify-approval-revoke') as HTMLInputElement)?.checked) throw new Error('Confirm that you verified the token contract, spender and network.');
      const request = approvalPending; approvalPending = null; $('approval-review').replaceChildren();
      requireSepolia((await provider.getNetwork()).chainId);
      const latest = BigInt(await new Contract(request.token.address, ERC20_ABI, provider).allowance(wallet.address, request.spender));
      if (latest === 0n) throw new Error('The allowance is already zero. Nothing was signed.');
      const signer = wallet.connect(provider);
      const populated = await signer.populateTransaction(request.tx);
      if (!valid()) throw new Error('Wallet locked or view changed. Nothing was signed.');
      assertFreshReview(approvalReviewedAt);
      assertSepoliaNonceFree(wallet.address, populated.nonce);
      const signed = await signer.signTransaction(populated);
      assertSignedMatchesReview(signed, { ...request.tx, nonce: populated.nonce }, signer.address);
      assertFreshReview(approvalReviewedAt);
      if (!valid()) throw new Error('Wallet locked or view changed. Revocation was not broadcast.');
      const hash = keccak256(signed);
      const entry: TokenSubmission = { hash, contract: request.token.address, to: request.spender, amount: '0', decimals: request.token.decimals, symbol: request.token.symbol, timestamp: new Date().toISOString(), status: 'unknown', nonce: populated.nonce ?? undefined, action: 'revoke' };
      const sent = await submitTracked(signed, entry, row => {
        const existing = strictSepoliaJournal(localStorage, journalKey(wallet.address));
        submissions = retainSepoliaSubmission(existing, row);
        saveSubmissions(); paintSubmissions(); paintApprovals();
      }, raw => provider.broadcastTransaction(raw), valid);
      if (!valid()) return;
      $('approval-notice').textContent = `Revocation submitted: ${sent.hash}. Check the explorer before retrying; scan again after the receipt.`;
      const link = document.createElement('a'); link.href = `https://sepolia.etherscan.io/tx/${sent.hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' View submitted revocation'; $('approval-notice').append(link);
      paintApprovals();
    }), 'approval-notice');
  }
  const balances = new Map<string, bigint>();
  let pending: { tx: TransactionRequest; token: Token; to: string; amount: bigint } | null = null;
  const $ = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
  const field = (id: string) => (host.querySelector(`#${id}`) as HTMLInputElement).value;
  const valid = () => !disposed && isCurrent();
  const message = (text: string) => { if (valid()) $('token-notice').textContent = text; };
  $('token-receive-address').textContent = wallet.address;
  $('token-contact').innerHTML = contactOptions(wallet.address);
  $('token-contact').addEventListener('change', () => { const input = host.querySelector('#token-recipient') as HTMLInputElement; input.value = field('token-contact'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  function list() {
    const selected = field('token-select');
    $('token-list').innerHTML = tokens.length ? tokens.filter(t => showHidden || !t.hidden).map(t => `<div class="token-row asset-row"><span class="asset-avatar" aria-hidden="true">◇</span><div class="asset-identity"><strong>${escape(t.symbol)} <span class="pill">Unverified test token</span></strong><p>${escape(t.name)}</p><code>${t.address}</code></div><div class="token-row-value"><strong>${hideBalance() ? '••••' : balances.has(t.address) ? escape(formatUnits(balances.get(t.address)!, t.decimals)) : '—'} ${escape(t.symbol)}</strong><p>Price unavailable</p><button class="quiet token-hide" data-hide-token="${t.address}">${t.hidden ? 'Unhide token' : 'Hide token'}</button></div></div>`).join('') : '<p>No tokens tracked yet. Add a Sepolia ERC-20 contract above.</p>';
    host.querySelectorAll<HTMLButtonElement>('[data-hide-token]').forEach(button => button.onclick = () => {
      if (working) return;
      const next = tokens.map(t => t.address === button.dataset.hideToken ? { ...t, hidden: !t.hidden } : t);
      localStorage.setItem(tokenKey(wallet.address), JSON.stringify(next));
      tokens = next; revision++; pending = null; $('token-review').replaceChildren(); list(); history();
      message('Token visibility changed locally. No assets were moved.');
    });
    $('tokens-hidden-toggle').textContent = showHidden ? 'Hide hidden assets' : `Show hidden (${tokens.filter(t => t.hidden).length})`;
    const tokenOptions = '<option value="">Choose a token</option>' + tokens.filter(t => !t.hidden).map(t => `<option value="${t.address}">${escape(t.symbol)} — ${t.address.slice(0, 10)}…${t.address.slice(-6)}</option>`).join('');
    const selectedApproval = (host.querySelector('#approval-token') as HTMLSelectElement | null)?.value || '';
    $('token-select').innerHTML = tokenOptions;
    (host.querySelector('#token-select') as HTMLSelectElement).value = selected;
    $('approval-token').innerHTML = tokenOptions;
    (host.querySelector('#approval-token') as HTMLSelectElement).value = tokens.some(t => !t.hidden && t.address === selectedApproval) ? selectedApproval : '';
    paintApprovals();
  }
  function history() {
    const tracked = new Map(tokens.filter(t => !t.hidden).map(t => [t.address.toLowerCase(), t]));
    $('token-history').innerHTML = transfers.filter(t => tracked.has(t.contract.toLowerCase())).map(t => {
      const token = tracked.get(t.contract.toLowerCase())!;
      const sent = t.from.toLowerCase() === wallet.address.toLowerCase();
      return `<div class="tx"><div><strong>${sent ? 'Sent' : 'Received'} ${escape(formatUnits(t.value, token.decimals))} ${escape(token.symbol)}</strong><p>${escape(new Date(t.timestamp).toLocaleString())} · Indexed transfer</p><code>${t.contract}</code></div><a href="https://sepolia.etherscan.io/tx/${t.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div>`;
    }).join('') || '<p>No indexed transfers loaded for tracked tokens.</p>';
    $('token-history-more').hidden = !cursor;
  }
  async function run(action: () => Promise<void>, errorTarget = 'token-notice') {
    if (working || !valid()) return;
    working = true;
    host.setAttribute('aria-busy', 'true');
    host.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true);
    try { await action(); } catch (e) { $(errorTarget).textContent = e instanceof Error ? e.message : 'Token request failed.'; }
    finally { working = false; if (valid()) { host.removeAttribute('aria-busy'); host.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false); } }
  }
  async function refreshBalances() {
    requireSepolia((await provider.getNetwork()).chainId);
    let failed = false;
    for (const t of tokens) {
      if (!valid()) return;
      try { const value = await new Contract(t.address, ERC20_ABI, provider).balanceOf(wallet.address); if (valid()) balances.set(t.address, BigInt(value)); }
      catch { balances.delete(t.address); failed = true; }
    }
    if (valid()) { list(); if (failed) message('Some token balances are unavailable. Check the RPC and contract addresses.'); }
  }
  async function refreshHistory(more = false) {
    await refreshSubmissions();
    const query = new URLSearchParams({ type: 'ERC-20' });
    if (more && cursor) Object.entries(cursor).forEach(([key, value]) => query.set(key, String(value)));
    const response = await fetch(`https://eth-sepolia.blockscout.com/api/v2/addresses/${wallet.address}/token-transfers?${query}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Token history is unavailable. Retry later or use the explorer.');
    const data = await response.json();
    const rows = parseTokenTransfers(data.items);
    if (!valid()) return;
    const merged = new Map(transfers.map(t => [`${t.hash}:${t.index}`, t]));
    rows.forEach(t => merged.set(`${t.hash}:${t.index}`, t));
    transfers = [...merged.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 1000);
    cursor = data.next_page_params && typeof data.next_page_params === 'object' ? data.next_page_params : null;
    history();
  }
  $('token-import').addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    if (tokens.length >= 25) throw new Error('Up to 25 tracked tokens are supported.');
    const address = tokenAddress(field('token-contract'));
    if (tokens.some(t => t.address === address)) throw new Error('This token is already tracked.');
    requireSepolia((await provider.getNetwork()).chainId);
    if (await provider.getCode(address) === '0x') throw new Error('No contract exists at this address on Sepolia.');
    const contract = new Contract(address, ERC20_ABI, provider);
    const [symbol, name, decimalsRaw, value] = await Promise.all([contract.symbol(), contract.name(), contract.decimals(), contract.balanceOf(wallet.address)]);
    const decimals = Number(decimalsRaw);
    if (!safeTokenText(symbol, 20) || !safeTokenText(name, 80) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token metadata. Names ≤80 characters, symbols ≤20 and decimals 0–36 are supported.');
    if (!valid()) return;
    const next = [...tokens, { address, symbol, name, decimals }];
    localStorage.setItem(tokenKey(wallet.address), JSON.stringify(next));
    tokens = next; balances.set(address, BigInt(value)); list(); history();
    (host.querySelector('#token-contract') as HTMLInputElement).value = '';
    message('Token added. Its name and symbol are unverified; check the contract address before sending.');
  }); });
  $('token-send').addEventListener('input', () => { revision++; pending = null; $('token-review').replaceChildren(); });
  $('token-send').addEventListener('change', () => { revision++; pending = null; $('token-review').replaceChildren(); });
  $('token-send').addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    pending = null; $('token-review').replaceChildren();
    const captured = revision;
    const token = tokens.find(t => !t.hidden && t.address === field('token-select'));
    if (!token) throw new Error('Choose a tracked token.');
    const to = tokenAddress(field('token-recipient'));
    if (to === token.address) throw new Error('Do not send a token to its own contract address.');
    const warning = contactNotice(to, loadContacts(wallet.address)) || recipientNotice(to, wallet.address, transfers.filter(t => t.from.toLowerCase() === wallet.address.toLowerCase()).map(t => t.to));
    const amount = tokenAmount(field('token-amount'), token.decimals);
    requireSepolia((await provider.getNetwork()).chainId);
    const contract = new Contract(token.address, ERC20_ABI, provider);
    const chainDecimals = Number(await contract.decimals());
    if (chainDecimals !== token.decimals) throw new Error('Token decimals changed or cached metadata differs from the contract. Do not send until verified.');
    const held = BigInt(await contract.balanceOf(wallet.address));
    if (amount > held) throw new Error('Insufficient token balance.');
    const tx: TransactionRequest = { to: token.address, value: 0n, data: tokenInterface.encodeFunctionData('transfer', [to, amount]), chainId: CHAIN_ID, type: 2 };
    const signer = wallet.connect(provider);
    // Simulate the call as well as gas estimation; no-return tokens are accepted, false is rejected.
    let simulated: string;
    try { simulated = await provider.call({ ...tx, from: wallet.address }); }
    catch (error) { throw new Error(simulationFailure(error)); }
    if (tokenSimulation(simulated, 'transfer') === 'rejected') throw new Error('Token rejected the simulated transfer (transfer returned false). Nothing was signed.');
    const gasLimit = (await signer.estimateGas(tx)) * 120n / 100n;
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Network fee unavailable.');
    affordable(0n, gasLimit, fees.maxFeePerGas, await provider.getBalance(wallet.address));
    if (!valid() || captured !== revision) return;
    reviewedAt = Date.now();
    pending = { token, to, amount, tx: { ...tx, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas } };
    $('token-review').innerHTML = `<div class="review"><strong>Review Sepolia token transfer</strong><p>Token: ${escape(token.symbol)} (unverified)</p><code>${token.address}</code><p>Recipient: ${to}</p><p>Amount: ${escape(formatUnits(amount, token.decimals))} ${escape(token.symbol)}</p><p>Maximum gas fee: ${formatEther(gasLimit * fees.maxFeePerGas)} Sepolia ETH</p><p class="recipient-warning">${escape(warning)}</p><p class="hint">Simulation: eth_call did not revert. This only detects reverts; it is not a balance-change preview or PPOM-grade coverage. Review expires in 2 minutes.</p><label class="check"><input id="verify-token-recipient" type="checkbox"> I verified the full recipient, token contract and Sepolia network.</label><button type="button" id="token-confirm" class="primary">Confirm & send test tokens</button><button type="button" id="token-cancel" class="quiet">Cancel</button></div>`;
    $('token-cancel').onclick = () => { pending = null; $('token-review').replaceChildren(); };
    $('token-confirm').onclick = () => void run(() => withSepoliaSendLock(wallet.address, async () => {
      if (!pending) throw new Error('Review the transfer again.');
      assertFreshReview(reviewedAt);
      if (!(host.querySelector('#verify-token-recipient') as HTMLInputElement)?.checked) throw new Error('Confirm that you verified the full recipient, contract and network.');
      const request = pending; pending = null; $('token-review').replaceChildren();
      requireSepolia((await provider.getNetwork()).chainId);
      const populated = await signer.populateTransaction(request.tx);
      if(!valid() || captured !== revision) throw new Error('Wallet locked or view changed. Nothing was signed.');
      assertFreshReview(reviewedAt);
      assertSepoliaNonceFree(wallet.address, populated.nonce);
      const signed = await signer.signTransaction(populated);
      assertSignedMatchesReview(signed, { ...request.tx, nonce: populated.nonce }, signer.address);
      assertFreshReview(reviewedAt);
      if (!valid()) throw new Error('Wallet locked or view changed. Transfer was not broadcast.');
      const hash = keccak256(signed);
      const entry: TokenSubmission = { hash, contract: request.token.address, to: request.to, amount: request.amount.toString(), decimals: request.token.decimals, symbol: request.token.symbol, timestamp: new Date().toISOString(), status: 'unknown', nonce: populated.nonce ?? undefined };
      const sent = await submitTracked(signed, entry, row => {
        // Reload to preserve records written by another view while RPC was pending.
        const existing = strictSepoliaJournal(localStorage, journalKey(wallet.address));
        submissions = retainSepoliaSubmission(existing, row);
        saveSubmissions(); paintSubmissions();
      }, raw => provider.broadcastTransaction(raw), () => valid() && captured === revision);
      if (!valid()) return;
      message(`Token transfer submitted: ${sent.hash}. Check the explorer before retrying; indexer history may lag.`);
      const link = document.createElement('a'); link.href = `https://sepolia.etherscan.io/tx/${sent.hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' View submitted transaction'; $('token-notice').append(link);
    }));
  }); });
  $('tokens-hidden-toggle').onclick = () => { if (working) return; showHidden = !showHidden; list(); };
  $('approvals-scan').onclick = () => void run(scanApprovals, 'approval-notice');
  $('approval-check').addEventListener('input', () => { approvalPending = null; $('approval-review').replaceChildren(); });
  $('approval-check').addEventListener('submit', event => { event.preventDefault(); void run(checkApproval, 'approval-notice'); });
  $('approval-list').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-revoke-token]');
    if (!button) return;
    const token = tokens.find(t => t.address === button.dataset.revokeToken);
    const spender = button.dataset.revokeSpender;
    if (token && spender) void run(() => prepareRevoke(token, spender), 'approval-notice');
  });
  $('tokens-refresh').onclick = () => void run(refreshBalances);
  $('token-history-refresh').onclick = () => void run(() => refreshHistory());
  $('token-history-more').onclick = () => void run(() => refreshHistory(true));
  list(); history(); paintSubmissions(); paintApprovals();
  void run(async () => { await refreshBalances(); await refreshHistory(); });
  return () => { disposed = true; pending = null; approvalPending = null; abort.abort(); };
}

export function mountTokenSummary(host: HTMLElement, provider: JsonRpcProvider, address: string, hidden: () => boolean) {
  let disposed = false;
  const tokens = loadTokens(address).filter(t => !t.hidden);
  const values = new Map<string, bigint>();
  const paint = () => {
    if (disposed) return;
    host.innerHTML = '<h2>Tracked ERC-20 assets</h2><p class="hint">Sepolia only. Token prices and profit/loss are unavailable; the USD estimate above covers native ETH only.</p>' + (tokens.length ? tokens.map(t => `<div class="token-row asset-row"><span class="asset-avatar" aria-hidden="true">◇</span><div class="asset-identity"><strong>${escape(t.symbol)}</strong><p>${escape(t.name)} · Unverified test token</p><code>${t.address}</code></div><div>${hidden() ? '••••' : values.has(t.address) ? escape(formatUnits(values.get(t.address)!, t.decimals)) : '—'} ${escape(t.symbol)}</div></div>`).join('') : '<p>No ERC-20 tokens tracked yet. Open Tokens to add a contract.</p>');
  };
  paint();
  void (async () => {
    try {
      requireSepolia((await provider.getNetwork()).chainId);
      for (const t of tokens) { if (disposed) return; try { const value = await new Contract(t.address, ERC20_ABI, provider).balanceOf(address); values.set(t.address, BigInt(value)); } catch { /* show unavailable */ } }
      paint();
    } catch { if (!disposed) host.append(document.createTextNode('Token balances unavailable; check the network.')); }
  })();
  host.parentElement?.addEventListener('portfolio-privacy-change', paint);
  return () => { disposed = true; host.parentElement?.removeEventListener('portfolio-privacy-change', paint); };
}

import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import { contactOptions, contactNotice, loadContacts } from './contacts';
import { journalKey, parseJournal, type TokenSubmission } from './token-journal';
import { assertFreshReview, assertSignedMatchesReview, recipientNotice, safeTokenText } from './transfer-safety';
import { Contract, formatUnits, formatEther, keccak256, type JsonRpcProvider, type Wallet, type HDNodeWallet, type TransactionRequest } from 'ethers';
import { CHAIN_ID, requireSepolia, affordable } from './wallet';
import { ERC20_ABI, loadTokens, tokenKey, tokenAddress, tokenAmount, tokenInterface, parseTokenTransfers, type Token, type TokenTransfer } from './token-data';

const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function tokensMarkup() {
  return `<section id="tokens-panel" class="asset-workspace"><section class="card asset-inventory"><div class="section-heading"><div><div class="eyebrow">YOUR ASSETS · ETHEREUM SEPOLIA</div><h2>Token collection</h2></div><button id="tokens-refresh" class="quiet">Refresh tokens</button></div><p>Track ERC-20 tokens by their Sepolia contract address. Names and symbols are self-reported by contracts; verify the full address independently. Test token prices are unavailable.</p><details class="asset-import"><summary>＋ Add a token</summary><form id="token-import"><label for="token-contract">Token contract address</label><input id="token-contract" placeholder="0x…" required autocomplete="off"><button class="primary">Validate & add token</button></form><p class="hint">Verify the full Sepolia contract address independently.</p></details><p id="token-notice" role="status" aria-live="polite"></p><button id="tokens-hidden-toggle" class="quiet">Show hidden tokens</button><div id="token-list" class="asset-list"></div></section>
  <div class="portfolio-grid lower asset-transfer-grid"><section class="card"><h2>Send a token</h2><form id="token-send"><label for="token-select">Token</label><select id="token-select" required></select><label for="token-contact">Saved recipient (optional)</label><select id="token-contact"></select><label for="token-recipient">Recipient address</label><input id="token-recipient" required placeholder="0x…" autocomplete="off"><label for="token-amount">Token amount</label><input id="token-amount" required inputmode="decimal" placeholder="0.00" autocomplete="off"><p class="hint">Gas is paid in Sepolia ETH. This sends tokens directly; it does not create an allowance.</p><button class="primary">Review token transfer</button></form><div id="token-review"></div></section><section class="card asset-receive"><h2>Receive tokens</h2><p>Use your existing Ethereum Sepolia wallet address for all supported ERC-20 tokens.</p><code id="token-receive-address" class="token-address"></code><p class="hint">Choose Ethereum Sepolia at the sender. Importing a token only adds it to your display; you can receive before importing.</p><p>USD price and profit/loss: unavailable for these test tokens.</p></section></div>
  <section class="card activity"><h2>Submitted token transfers</h2><p class="hint">Locally recorded submissions, including uncertain broadcasts. Unknown does not mean failed. Check the explorer before retrying. Receipt status is supplied by the RPC.</p><div id="token-submissions"></div><div class="section-heading"><h2>Token transfer history</h2><button id="token-history-refresh" class="quiet">Refresh history</button></div><p class="hint">Indexed ERC-20 transfers for your tracked contracts. An indexer may lag. Open the explorer to verify confirmation.</p><div id="token-history"></div><button id="token-history-more" class="quiet" hidden>Load older token transfers</button></section></section>`;
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
  try { submissions = parseJournal(JSON.parse(localStorage.getItem(journalKey(wallet.address)) || '[]')); } catch { /* no valid local journal */ }
  function saveSubmissions() { localStorage.setItem(journalKey(wallet.address), JSON.stringify(submissions)); }
  function paintSubmissions() {
    if (!valid()) return;
    $('token-submissions').innerHTML = submissions.map(r => `<div class="tx"><div><strong>${escape(formatUnits(r.amount, r.decimals))} ${escape(r.symbol)}</strong><p>${r.status} &middot; ${escape(new Date(r.timestamp).toLocaleString())}</p><p>${escape(submissionDetail(r))}</p><code>${r.to}</code></div><a href="https://sepolia.etherscan.io/tx/${r.hash}" target="_blank" rel="noopener noreferrer">View transaction</a></div>`).join('') || '<p>No locally recorded token submissions.</p>';
  }
  async function refreshSubmissions() {
    requireSepolia((await provider.getNetwork()).chainId);
    const updated = await inspectSubmissions(submissions, { receipt: hash => provider.getTransactionReceipt(hash), height: () => provider.getBlockNumber(), transaction: hash => provider.getTransaction(hash), minedNonce: () => provider.getTransactionCount(wallet.address, 'latest') });
    if (!valid()) return;
    let latest = submissions;
    try { latest = parseJournal(JSON.parse(localStorage.getItem(journalKey(wallet.address)) || '[]')); } catch { /* use in-memory records */ }
    const updates = new Map(updated.map(row => [row.hash, row]));
    submissions = latest.map(row => updates.get(row.hash) ?? row); saveSubmissions(); paintSubmissions();
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
    $('token-select').innerHTML = '<option value="">Choose a token</option>' + tokens.filter(t => !t.hidden).map(t => `<option value="${t.address}">${escape(t.symbol)} — ${t.address.slice(0, 10)}…${t.address.slice(-6)}</option>`).join('');
    (host.querySelector('#token-select') as HTMLSelectElement).value = selected;
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
  async function run(action: () => Promise<void>) {
    if (working || !valid()) return;
    working = true;
    host.setAttribute('aria-busy', 'true');
    host.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true);
    try { await action(); } catch (e) { message(e instanceof Error ? e.message : 'Token request failed.'); }
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
    // Simulate transfer as well as gas estimation to catch tokens returning false.
    const simulated = await provider.call({ ...tx, from: wallet.address });
    if (simulated !== '0x' && !tokenInterface.decodeFunctionResult('transfer', simulated)[0]) throw new Error('Token rejected the simulated transfer.');
    const gasLimit = (await signer.estimateGas(tx)) * 120n / 100n;
    const fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Network fee unavailable.');
    affordable(0n, gasLimit, fees.maxFeePerGas, await provider.getBalance(wallet.address));
    if (!valid() || captured !== revision) return;
    reviewedAt = Date.now();
    pending = { token, to, amount, tx: { ...tx, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas } };
    $('token-review').innerHTML = `<div class="review"><strong>Review Sepolia token transfer</strong><p>Token: ${escape(token.symbol)} (unverified)</p><code>${token.address}</code><p>Recipient: ${to}</p><p>Amount: ${escape(formatUnits(amount, token.decimals))} ${escape(token.symbol)}</p><p>Maximum gas fee: ${formatEther(gasLimit * fees.maxFeePerGas)} Sepolia ETH</p><p class="recipient-warning">${escape(warning)}</p><p class="hint">Transfer simulation passed; contract behavior can still change. Review expires in 2 minutes.</p><label class="check"><input id="verify-token-recipient" type="checkbox"> I verified the full recipient, token contract and Sepolia network.</label><button type="button" id="token-confirm" class="primary">Confirm & send test tokens</button><button type="button" id="token-cancel" class="quiet">Cancel</button></div>`;
    $('token-cancel').onclick = () => { pending = null; $('token-review').replaceChildren(); };
    $('token-confirm').onclick = () => void run(async () => {
      if (!pending) throw new Error('Review the transfer again.');
      assertFreshReview(reviewedAt);
      if (!(host.querySelector('#verify-token-recipient') as HTMLInputElement)?.checked) throw new Error('Confirm that you verified the full recipient, contract and network.');
      const request = pending; pending = null; $('token-review').replaceChildren();
      requireSepolia((await provider.getNetwork()).chainId);
      const populated = await signer.populateTransaction(request.tx);
      if(!valid()) throw new Error('Wallet locked or view changed. Nothing was signed.');
      assertFreshReview(reviewedAt);
      const signed = await signer.signTransaction(populated);
      assertSignedMatchesReview(signed, { ...request.tx, nonce: populated.nonce }, signer.address);
      assertFreshReview(reviewedAt);
      if (!valid()) throw new Error('Wallet locked or view changed. Transfer was not broadcast.');
      const hash = keccak256(signed);
      const entry: TokenSubmission = { hash, contract: request.token.address, to: request.to, amount: request.amount.toString(), decimals: request.token.decimals, symbol: request.token.symbol, timestamp: new Date().toISOString(), status: 'unknown', nonce: populated.nonce ?? undefined };
      const sent = await submitTracked(signed, entry, row => {
        // Reload to preserve records written by another view while RPC was pending.
        let existing: TokenSubmission[] = [];
        try { existing = parseJournal(JSON.parse(localStorage.getItem(journalKey(wallet.address)) || '[]')); } catch { /* retain valid in-memory records */ }
        submissions = [row, ...existing.filter(r => r.hash !== hash)].slice(0, 200);
        saveSubmissions(); paintSubmissions();
      }, raw => provider.broadcastTransaction(raw), () => valid() && captured === revision);
      if (!valid()) return;
      message(`Token transfer submitted: ${sent.hash}. Check the explorer before retrying; indexer history may lag.`);
      const link = document.createElement('a'); link.href = `https://sepolia.etherscan.io/tx/${sent.hash}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = ' View submitted transaction'; $('token-notice').append(link);
    });
  }); });
  $('tokens-hidden-toggle').onclick = () => { if (working) return; showHidden = !showHidden; list(); };
  $('tokens-refresh').onclick = () => void run(refreshBalances);
  $('token-history-refresh').onclick = () => void run(() => refreshHistory());
  $('token-history-more').onclick = () => void run(() => refreshHistory(true));
  list(); history(); paintSubmissions();
  void run(async () => { await refreshBalances(); await refreshHistory(); });
  return () => { disposed = true; pending = null; abort.abort(); };
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

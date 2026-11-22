import { Contract, JsonRpcProvider, Wallet, HDNodeWallet, ZeroAddress, formatEther, formatUnits, keccak256, type TransactionRequest } from 'ethers';
import QRCode from 'qrcode';
import { evmNetworks, requireEvmNetwork, type EvmNetworkId } from './evm-networks';
import { evmTokenKey, evmJournalKey, readEvmTokens, readEvmJournal, retainEvmSubmission, requireResolvedEvm, evmSendLock, evmTokenPage, loadEvmPageBalances, EVM_TOKEN_LIMIT, EVM_TOKEN_PAGE_SIZE } from './evm-assets';
import { ERC20_ABI, tokenInterface, tokenAddress, tokenAmount, savedTokens, type Token } from './token-data';
import { assertFreshReview, assertSignedMatchesReview, safeTokenText } from './transfer-safety';
import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import type { TokenSubmission } from './token-journal';
import { enhanceCards } from './ui-panels';
import { mountTokenDiscovery } from './token-discovery-ui';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Review = { tx: TransactionRequest; to: string; amount: bigint; token?: Token; created: number };
export async function verifyEvmTokenTransfer(provider: Pick<JsonRpcProvider, 'getCode' | 'call'>, owner: string, token: Token, amount: bigint, tx: TransactionRequest) {
  if (tokenAddress(String(tx.to)) !== token.address || BigInt(tx.value || 0) !== 0n
    || BigInt(tokenInterface.decodeFunctionData('transfer', tx.data || '0x')[1]) !== amount) throw new Error('Token simulation differs from the reviewed contract or amount.');
  if (await provider.getCode(token.address) === '0x') throw new Error('The reviewed token contract is no longer available. Review again.');
  const [decimalsData, balanceData] = await Promise.all([
    provider.call({ to: token.address, data: tokenInterface.encodeFunctionData('decimals'), from: owner }),
    provider.call({ to: token.address, data: tokenInterface.encodeFunctionData('balanceOf', [owner]), from: owner }),
  ]);
  if (Number(tokenInterface.decodeFunctionResult('decimals', decimalsData)[0]) !== token.decimals) throw new Error('Token decimals changed. Remove and verify the token again.');
  if (BigInt(tokenInterface.decodeFunctionResult('balanceOf', balanceData)[0]) < amount) throw new Error('Insufficient token balance.');
  const result = await provider.call({ ...tx, from: owner });
  if (!tokenInterface.decodeFunctionResult('transfer', result)[0]) throw new Error('Token transfer simulation returned false.');
}
export function mountEvmWorkspace(host: HTMLElement, network: EvmNetworkId, wallet: Wallet | HDNodeWallet, session: {
  current(): boolean; hidden(): boolean; toggleHidden(): void; page: string;
}) {
  const config = evmNetworks[network], chainId = BigInt(config.chainId), owner = wallet.address;
  const provider = new JsonRpcProvider(config.rpc);
  let disposed = false, busy = false, review: Review | undefined, revision = 0;
  let balance: bigint | undefined;
  let tokenQuery = '', tokenPage = 0;
  let disposeDiscovery: (() => void) | undefined, discoveryOpened = false;
  let initialRefresh: Promise<void> = Promise.resolve();
  const balances = new Map<string, bigint | undefined>();
  const current = () => !disposed && session.current() && host.isConnected;
  const live = () => { if (!current()) throw new Error('Wallet locked or account/network changed. Nothing further was signed or submitted.'); };
  const $ = (id: string) => host.querySelector<HTMLElement>(`#evm-${id}`)!;
  const input = (id: string) => ($(id) as HTMLInputElement).value;
  const tokens = () => readEvmTokens(localStorage, network, owner);
  const visibleTokens = () => evmTokenPage(tokens(), tokenQuery, tokenPage);
  const journal = () => readEvmJournal(localStorage, network, owner);
  const record = (row: TokenSubmission) => localStorage.setItem(evmJournalKey(network, owner), JSON.stringify(retainEvmSubmission(journal(), row)));
  const networkCheck = async () => { requireEvmNetwork(network, (await provider.getNetwork()).chainId); live(); };
  const display = (amount: bigint | undefined, decimals = 18) => session.hidden() ? '••••••' : amount === undefined ? 'Unavailable' : formatUnits(amount, decimals);
  function notice(text: string, error = false) {
    if (!current()) return;
    const el = $('notice'); el.textContent = text;
    el.className = error ? 'form-error evm-notice' : 'hint evm-notice';
    el.setAttribute('role', error ? 'alert' : 'status');
    if (error) { el.tabIndex = -1; el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }
  function amounts() {
    if (!current()) return;
    $('balance').textContent = `${display(balance, config.decimals)} ${config.symbol}`;
    $('privacy').textContent = session.hidden() ? 'Show balances' : 'Hide balances';
    $('privacy').setAttribute('aria-pressed', String(session.hidden()));
    for (const token of visibleTokens().tokens) {
      const el = host.querySelector<HTMLElement>(`[data-evm-balance="${token.address}"]`);
      if (el) el.textContent = session.hidden() ? '••••••' : !balances.has(token.address) ? 'Not loaded · refresh page' : `${display(balances.get(token.address), token.decimals)} ${token.symbol}`;
    }
  }
  function history() {
    if (!current()) return;
    $('history').innerHTML = journal().map(row => `<div class="history-row"><div class="history-identity"><strong>Sent ${escape(row.symbol)} · ${escape(row.status)}</strong><p>${escape(new Date(row.timestamp).toLocaleString())}</p><code>To: ${escape(row.to)}</code><p>${escape(submissionDetail(row))}</p><a href="${config.explorer}/tx/${row.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${session.hidden() ? '••••••' : escape(formatUnits(row.amount, row.decimals))} ${escape(row.symbol)}</strong></div></div>`).join('') || '<p>No locally submitted transfers for this account and chain.</p>';
  }
  function inventory() {
    if (!current()) return;
    const page = visibleTokens(); tokenPage = page.page;
    $('token-count').textContent = `${tokens().length} / ${EVM_TOKEN_LIMIT} tracked · ${page.total} matching · page ${page.page + 1} of ${page.pages}`;
    $('token-list').innerHTML = page.tokens.map(token => `<div class="asset-row"><div><strong>${escape(token.symbol)}</strong><p>${escape(token.name)} · unverified</p><code>${token.address}</code></div><strong data-evm-balance="${token.address}">Not loaded · refresh page</strong><button type="button" class="quiet" data-evm-remove="${token.address}">Remove tracking</button></div>`).join('') || '<p>No tokens match this search. Import a verified contract on the selected network.</p>';
    ($('previous') as HTMLButtonElement).disabled = busy || page.page === 0;
    ($('next') as HTMLButtonElement).disabled = busy || page.page + 1 >= page.pages;
    $('token-list').querySelectorAll<HTMLButtonElement>('[data-evm-remove]').forEach(button => button.onclick = () => {
      if (busy || !current()) return;
      localStorage.setItem(evmTokenKey(network, owner), JSON.stringify(tokens().filter(token => token.address !== button.dataset.evmRemove)));
      paint(); notice('Token tracking removed from this account and network. The on-chain balance is unchanged.');
    });
    amounts();
  }
  function controls() {
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(el => { el.disabled = busy; });
    const page = visibleTokens();
    ($('previous') as HTMLButtonElement).disabled = busy || page.page === 0;
    ($('next') as HTMLButtonElement).disabled = busy || page.page + 1 >= page.pages;
  }
  async function run(work: () => Promise<void>) {
    if (busy || !current()) return;
    busy = true; controls();
    try { await work(); } catch (error) {
      // Never expose RPC diagnostic payloads or untrusted exception strings.
      const message = error instanceof Error && !('code' in error) && error.message.length < 350 ? error.message : 'Network operation failed. Check the selected testnet, balance and connection, then refresh.';
      notice(message, true);
    } finally { if (current()) { busy = false; controls(); inventory(); } }
  }
  async function refreshVisibleBalances() {
    await loadEvmPageBalances(visibleTokens().tokens,
      async token => BigInt(await new Contract(token.address, ERC20_ABI, provider).balanceOf(owner)), current,
      (token, value) => { balances.set(token.address, value); amounts(); });
  }
  async function refresh() {
    await networkCheck();
    const value = await provider.getBalance(owner); live(); balance = value; amounts();
    await refreshVisibleBalances();
    const inspected = await inspectSubmissions(journal(), {
      receipt: hash => provider.getTransactionReceipt(hash), height: () => provider.getBlockNumber(),
      transaction: hash => provider.getTransaction(hash), minedNonce: () => provider.getTransactionCount(owner, 'latest'),
    });
    live();
    const updates = new Map(inspected.map(row => [row.hash, row]));
    // Merge against fresh storage, retaining a transfer another tab just recorded.
    localStorage.setItem(evmJournalKey(network, owner), JSON.stringify(journal().map(row => updates.get(row.hash) || row)));
    history(); notice('Balances and available submission statuses refreshed.');
  }
  async function importToken() {
    const address = tokenAddress(input('contract'));
    await networkCheck();
    if (await provider.getCode(address) === '0x') throw new Error('No token contract exists at this address on the selected testnet.');
    const contract = new Contract(address, ERC20_ABI, provider);
    const [name, symbol, rawDecimals] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]); live();
    const decimals = Number(rawDecimals);
    if (!safeTokenText(name, 80) || !safeTokenText(symbol, 20) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported or unsafe token metadata.');
    const existing = tokens();
    if (existing.some(token => token.address === address)) throw new Error('This contract is already tracked on this network.');
    if (existing.length >= EVM_TOKEN_LIMIT) throw new Error(`Up to ${EVM_TOKEN_LIMIT} tracked tokens per account and network.`);
    localStorage.setItem(evmTokenKey(network, owner), JSON.stringify([...existing, { address, name, symbol, decimals }]));
    tokenQuery = ''; tokenPage = Math.floor(existing.length / EVM_TOKEN_PAGE_SIZE);
    paint(); await refresh();
  }
  async function prepare() {
    review = undefined; $('review').replaceChildren();
    const version = ++revision, to = tokenAddress(input('to')), selected = input('asset');
    const token = selected === 'native' ? undefined : tokens().find(token => token.address === selected);
    if (selected !== 'native' && !token) throw new Error('Select a tracked token.');
    const amount = tokenAmount(input('amount'), token?.decimals ?? config.decimals);
    if (token && to === token.address) throw new Error('Do not send a token to its own contract.');
    await networkCheck(); requireResolvedEvm(journal());
    const tx: TransactionRequest = { to: token?.address || to, value: token ? 0n : amount, data: token ? tokenInterface.encodeFunctionData('transfer', [to, amount]) : '0x', chainId, type: 2 };
    const signer = wallet.connect(provider);
    if (token) await verifyEvmTokenTransfer(provider, owner, token, amount, tx);
    const gas = await signer.estimateGas(tx), fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('EIP-1559 fee data unavailable.');
    tx.gasLimit = gas + gas / 5n; tx.maxFeePerGas = fees.maxFeePerGas; tx.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    if (await provider.getBalance(owner, 'pending') < BigInt(tx.value || 0) + BigInt(tx.gasLimit) * fees.maxFeePerGas) throw new Error(`Insufficient test ${config.symbol} for amount and maximum execution fee.`);
    live(); if (version !== revision) return;
    review = { tx, to, amount, token, created: Date.now() };
    $('review').innerHTML = `<div class="review"><h3>Review ${escape(config.network)} transfer</h3><p>Chain ID: ${config.chainId}</p><code>To: ${to}</code>${token ? `<p>Contract: <code>${token.address}</code></p>` : ''}<p>Amount: ${escape(formatUnits(amount, token?.decimals ?? config.decimals))} ${escape(token?.symbol || config.symbol)}</p><p>Maximum execution fee: ${formatEther(BigInt(tx.gasLimit) * fees.maxFeePerGas)} ${escape(config.symbol)}. L2 chains may charge additional data fees; this is not a complete L2 fee quote.</p><p>Test assets only. Token labels are unverified. Review expires in two minutes.</p><label class="check"><input id="evm-ack" type="checkbox"> I checked the full recipient, contract and selected test network.</label><button id="evm-confirm" type="button" class="primary">Sign & send test transfer</button><button id="evm-cancel" type="button" class="quiet">Cancel</button></div>`;
    $('confirm').onclick = () => { void run(send); };
    $('cancel').onclick = () => { revision++; review = undefined; $('review').replaceChildren(); };
  }
  async function send() {
    if (!review || !($('ack') as HTMLInputElement).checked) throw new Error('Review and acknowledge the full transfer details first.');
    if (!navigator.locks) throw new Error('This browser cannot coordinate safe sends. Use a current browser over HTTPS or localhost.');
    const r = review, version = revision;
    const fresh = () => { live(); if (version !== revision) throw new Error('Transfer changed. Review again.'); assertFreshReview(r.created); };
    await navigator.locks.request(evmSendLock(network, owner), { ifAvailable: true }, async lock => {
      if (!lock) throw new Error('Another tab is submitting a transfer for this account and chain.');
      fresh(); await networkCheck(); requireResolvedEvm(journal()); fresh();
      review = undefined; $('review').replaceChildren();
      const signer = wallet.connect(provider);
      if (r.token) await verifyEvmTokenTransfer(provider, owner, r.token, r.amount, r.tx);
      fresh();
      if (await signer.estimateGas(r.tx) > BigInt(r.tx.gasLimit!)) throw new Error('Execution gas changed. Review the transfer and fee again.');
      if (await provider.getBalance(owner, 'pending') < BigInt(r.tx.value || 0) + BigInt(r.tx.gasLimit!) * BigInt(r.tx.maxFeePerGas!)) throw new Error(`Insufficient test ${config.symbol} for the reviewed transfer and fee.`);
      fresh();
      const populated = await signer.populateTransaction(r.tx);
      fresh();
      const raw = await signer.signTransaction(populated);
      fresh(); assertSignedMatchesReview(raw, { ...r.tx, nonce: populated.nonce }, owner, chainId);
      await networkCheck(); fresh();
      const entry: TokenSubmission = { hash: keccak256(raw), contract: r.token?.address || ZeroAddress, to: r.to, amount: String(r.amount), decimals: r.token?.decimals ?? config.decimals, symbol: r.token?.symbol || config.symbol, timestamp: new Date().toISOString(), status: 'unknown', nonce: populated.nonce ?? undefined };
      await submitTracked(raw, entry, record, signed => provider.broadcastTransaction(signed), current);
      if (current()) { history(); notice('Submitted. Check the explorer and refresh before making another transfer.'); }
    });
  }
  function paint() {
    disposeDiscovery?.(); disposeDiscovery = undefined;
    review = undefined; revision++;
    const list = tokens();
    host.innerHTML = `<p id="evm-notice" class="hint" role="status">Loading ${escape(config.network)}…</p>
      <section class="balance-card"><div class="eyebrow">${escape(config.network)} · CHAIN ${config.chainId}</div><h2 id="evm-balance">— ${escape(config.symbol)}</h2><p>Uses your selected Ethereum account address. Balances and contracts are separate on each chain.</p><div class="balance-actions"><button id="evm-refresh" type="button" class="quiet">Refresh</button><button id="evm-privacy" type="button" class="quiet">Hide balances</button></div></section>
      <div class="wallet-grid" style="margin-top:24px"><section class="card"><h2>Send crypto</h2><form id="evm-send"><label for="evm-asset">Asset on ${escape(config.network)}</label><select id="evm-asset"><option value="native">${escape(config.symbol)} · native gas token</option>${list.map(token => `<option value="${token.address}">${escape(token.symbol)} · ${token.address.slice(0, 8)}…${token.address.slice(-6)}</option>`).join('')}</select><label for="evm-to">Recipient address</label><input id="evm-to" required autocomplete="off" placeholder="0x…" maxlength="42"><label for="evm-amount">Amount</label><input id="evm-amount" required inputmode="decimal" autocomplete="off" maxlength="120"><button class="primary">Review transfer</button></form><div id="evm-review"></div></section>
      <section class="card"><h2>Receive crypto</h2><p>${escape(config.network)} only · same EVM address, different network</p><canvas id="evm-qr" aria-label="Selected testnet receive address QR"></canvas><code class="multi-address">${owner}</code><button id="evm-copy" type="button" class="quiet">Copy address</button><p>Choose this exact network at the sender. Adding a token does not bridge funds.</p><a href="${config.explorer}/address/${owner}" target="_blank" rel="noopener noreferrer">View account on explorer ↗</a></section></div>
      <section class="card" style="margin-top:24px"><h2>Tokens on ${escape(config.network)}</h2><p>Add a standard ERC-20 contract deployed on this testnet. USDT/USDC labels can be copied by anyone; verify the address with its issuer. Native SOL belongs to Solana. Wrapped assets here are separate contracts.</p><form id="evm-import"><label for="evm-contract">Token contract address</label><input id="evm-contract" required autocomplete="off" placeholder="0x…" maxlength="42"><button class="quiet">Import token</button></form><div class="history-controls"><label for="evm-token-query">Search tracked tokens<input id="evm-token-query" type="search" maxlength="100" placeholder="Name, symbol or contract" value="${escape(tokenQuery)}"></label><button id="evm-search" type="button" class="quiet">Search tokens</button><button id="evm-token-refresh" type="button" class="quiet">Refresh visible balances</button></div><p id="evm-token-count" class="hint"></p><div id="evm-token-list"></div><div class="balance-actions"><button id="evm-previous" type="button" class="quiet">Previous tokens</button><button id="evm-next" type="button" class="quiet">Next tokens</button></div><p class="hint">Up to ${EVM_TOKEN_LIMIT} manually imported contracts per account and chain. Balance requests cover only the visible ${EVM_TOKEN_PAGE_SIZE}-token page with at most three requests in flight. Search and page navigation preserve the transfer form.</p></section>
      <section class="card activity-workspace" style="margin-top:24px"><h2>Local transfer history</h2><p>Transfers submitted from this browser only. Incoming transfers and transfers from other wallets are available on the explorer. Unknown does not mean failed; never retry automatically.</p><div id="evm-history"></div></section>`;
    $('refresh').onclick = () => { void run(refresh); };
    $('privacy').onclick = () => { session.toggleHidden(); amounts(); history(); };
    $('copy').onclick = () => { void run(async () => { await navigator.clipboard.writeText(owner); notice('Public address copied.'); }); };
    $('import').onsubmit = event => { event.preventDefault(); void run(importToken); };
    $('send').onsubmit = event => { event.preventDefault(); void run(prepare); };
    const invalidate = () => { revision++; review = undefined; $('review').replaceChildren(); };
    $('send').addEventListener('input', invalidate); $('send').addEventListener('change', invalidate);
    const changeTokenPage = (page: number, search = tokenQuery) => {
      if (busy || !current()) return;
      tokenQuery = search.trim().slice(0, 100); tokenPage = page; inventory();
      void run(async () => { await networkCheck(); await refreshVisibleBalances(); notice('Visible token balances refreshed.'); });
    };
    $('search').onclick = () => changeTokenPage(0, input('token-query'));
    $('token-query').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); changeTokenPage(0, input('token-query')); } };
    $('previous').onclick = () => changeTokenPage(tokenPage - 1);
    $('next').onclick = () => changeTokenPage(tokenPage + 1);
    $('token-refresh').onclick = () => { void run(async () => { await networkCheck(); await refreshVisibleBalances(); notice('Visible token balances refreshed.'); }); };
    const summary = $('balance').closest<HTMLElement>('section')!;
    const transfer = $('send').closest<HTMLElement>('.wallet-grid')!;
    const inventorySection = $('import').closest<HTMLElement>('section')!;
    const activity = $('history').closest<HTMLElement>('section')!;
    transfer.classList.add('native-transfer-grid'); inventorySection.classList.add('asset-inventory');
    summary.hidden = !['overview', 'portfolio'].includes(session.page);
    transfer.hidden = !['overview', 'transfer', 'tokens'].includes(session.page);
    inventorySection.hidden = !['overview', 'portfolio', 'tokens'].includes(session.page);
    activity.hidden = !['overview', 'activity'].includes(session.page);
    inventory(); try { history(); } catch (error) { notice((error as Error).message, true); }
    const discoveryHost = document.createElement('div'); discoveryHost.className = 'token-discovery-panel'; inventorySection.append(discoveryHost);
    disposeDiscovery = mountTokenDiscovery(discoveryHost, {
      owner, chainId, provider, current, ready: () => initialRefresh,
      isTracked: token => tokens().some(item => item.address.toLowerCase() === token.address.toLowerCase()),
      autoStart: session.page === 'tokens' && !discoveryOpened,
      onImport: candidate => {
        live(); if (busy) throw new Error('Wait for the current wallet operation before importing.');
        const token = savedTokens([candidate])[0];
        if (!token) throw new Error('Invalid discovered token metadata.');
        const existing = tokens();
        if (existing.some(item => item.address.toLowerCase() === token.address.toLowerCase())) throw new Error('This token is already tracked.');
        if (existing.length >= EVM_TOKEN_LIMIT) throw new Error('Token inventory limit reached.');
        // The write is synchronous and precedes repaint; failed storage cannot report success.
        localStorage.setItem(evmTokenKey(network, owner), JSON.stringify([...existing, token]));
        revision++; review = undefined; tokenQuery = ''; tokenPage = Math.floor(existing.length / EVM_TOKEN_PAGE_SIZE);
        paint(); void run(refresh);
      },
    });
    if (session.page === 'tokens') discoveryOpened = true;
    enhanceCards(host); controls();
    void QRCode.toCanvas($('qr'), `ethereum:${owner}@${config.chainId}`, { width: 180, margin: 2 }).catch(() => {});
  }
  const changed = (event: StorageEvent) => {
    if (event.key === evmJournalKey(network, owner) || event.key === evmTokenKey(network, owner) || event.key === null) {
      revision++; review = undefined;
      if (current()) { $('review').replaceChildren(); notice('Another tab changed this account. Refresh balances and statuses before sending.'); }
    }
  };
  window.addEventListener('storage', changed);
  paint(); initialRefresh = run(refresh);
  return () => { disposed = true; revision++; review = undefined; disposeDiscovery?.(); window.removeEventListener('storage', changed); provider.destroy(); };
}

import { Contract, JsonRpcProvider, Wallet, HDNodeWallet, ZeroAddress, formatEther, formatUnits, keccak256, type TransactionRequest } from 'ethers';
import QRCode from 'qrcode';
import { evmNetworks, requireEvmNetwork, type EvmNetworkId } from './evm-networks';
import { evmTokenKey, evmJournalKey, readEvmTokens, readEvmJournal, retainEvmSubmission, requireResolvedEvm, evmSendLock } from './evm-assets';
import { ERC20_ABI, tokenInterface, tokenAddress, tokenAmount, type Token } from './token-data';
import { assertFreshReview, assertSignedMatchesReview, safeTokenText } from './transfer-safety';
import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import type { TokenSubmission } from './token-journal';
import { enhanceCards } from './ui-panels';

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Review = { tx: TransactionRequest; to: string; amount: bigint; token?: Token; created: number };
export function mountEvmWorkspace(host: HTMLElement, network: EvmNetworkId, wallet: Wallet | HDNodeWallet, session: {
  current(): boolean; hidden(): boolean; toggleHidden(): void; page: string;
}) {
  const config = evmNetworks[network], chainId = BigInt(config.chainId), owner = wallet.address;
  const provider = new JsonRpcProvider(config.rpc);
  let disposed = false, busy = false, review: Review | undefined, revision = 0;
  let balance: bigint | undefined;
  const balances = new Map<string, bigint | undefined>();
  const current = () => !disposed && session.current() && host.isConnected;
  const live = () => { if (!current()) throw new Error('Wallet locked or account/network changed. Nothing further was signed or submitted.'); };
  const $ = (id: string) => host.querySelector<HTMLElement>(`#evm-${id}`)!;
  const input = (id: string) => ($(id) as HTMLInputElement).value;
  const tokens = () => readEvmTokens(localStorage, network, owner);
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
    $('balance').textContent = `${display(balance)} ETH`;
    $('privacy').textContent = session.hidden() ? 'Show balances' : 'Hide balances';
    $('privacy').setAttribute('aria-pressed', String(session.hidden()));
    for (const token of tokens()) {
      const el = host.querySelector<HTMLElement>(`[data-evm-balance="${token.address}"]`);
      if (el) el.textContent = `${display(balances.get(token.address), token.decimals)} ${token.symbol}`;
    }
  }
  function history() {
    if (!current()) return;
    $('history').innerHTML = journal().map(row => `<div class="history-row"><div class="history-identity"><strong>Sent ${escape(row.symbol)} · ${escape(row.status)}</strong><p>${escape(new Date(row.timestamp).toLocaleString())}</p><code>To: ${escape(row.to)}</code><p>${escape(submissionDetail(row))}</p><a href="${config.explorer}/tx/${row.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${session.hidden() ? '••••••' : escape(formatUnits(row.amount, row.decimals))} ${escape(row.symbol)}</strong></div></div>`).join('') || '<p>No locally submitted transfers for this account and chain.</p>';
  }
  function controls() { host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(el => { el.disabled = busy; }); }
  async function run(work: () => Promise<void>) {
    if (busy || !current()) return;
    busy = true; controls();
    try { await work(); } catch (error) {
      // Never expose RPC diagnostic payloads or untrusted exception strings.
      const message = error instanceof Error && !('code' in error) && error.message.length < 350 ? error.message : 'Network operation failed. Check the selected testnet, balance and connection, then refresh.';
      notice(message, true);
    } finally { if (current()) { busy = false; controls(); } }
  }
  async function refresh() {
    await networkCheck();
    const value = await provider.getBalance(owner); live(); balance = value; amounts();
    const list = tokens(); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
      while (next < list.length && current()) {
        const token = list[next++];
        try { const value = BigInt(await new Contract(token.address, ERC20_ABI, provider).balanceOf(owner)); live(); balances.set(token.address, value); }
        catch { if (!current()) return; balances.set(token.address, undefined); }
        amounts();
      }
    }));
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
    if (existing.length >= 25) throw new Error('Up to 25 tracked tokens per account and network.');
    localStorage.setItem(evmTokenKey(network, owner), JSON.stringify([...existing, { address, name, symbol, decimals }]));
    paint(); await refresh();
  }
  async function prepare() {
    review = undefined; $('review').replaceChildren();
    const version = ++revision, to = tokenAddress(input('to')), selected = input('asset');
    const token = selected === 'native' ? undefined : tokens().find(token => token.address === selected);
    if (selected !== 'native' && !token) throw new Error('Select a tracked token.');
    const amount = tokenAmount(input('amount'), token?.decimals ?? 18);
    if (token && to === token.address) throw new Error('Do not send a token to its own contract.');
    await networkCheck(); requireResolvedEvm(journal());
    const tx: TransactionRequest = { to: token?.address || to, value: token ? 0n : amount, data: token ? tokenInterface.encodeFunctionData('transfer', [to, amount]) : '0x', chainId, type: 2 };
    const signer = wallet.connect(provider);
    if (token) {
      const contract = new Contract(token.address, ERC20_ABI, provider);
      if (Number(await contract.decimals()) !== token.decimals) throw new Error('Token decimals changed. Remove and verify the token again.');
      if (BigInt(await contract.balanceOf(owner)) < amount) throw new Error('Insufficient token balance.');
      const result = await provider.call({ ...tx, from: owner });
      if (!tokenInterface.decodeFunctionResult('transfer', result)[0]) throw new Error('Token transfer simulation returned false.');
    }
    const gas = await signer.estimateGas(tx), fees = await provider.getFeeData();
    if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('EIP-1559 fee data unavailable.');
    tx.gasLimit = gas + gas / 5n; tx.maxFeePerGas = fees.maxFeePerGas; tx.maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
    if (await provider.getBalance(owner) < BigInt(tx.value || 0) + BigInt(tx.gasLimit) * fees.maxFeePerGas) throw new Error('Insufficient test ETH for amount and maximum execution fee.');
    live(); if (version !== revision) return;
    review = { tx, to, amount, token, created: Date.now() };
    $('review').innerHTML = `<div class="review"><h3>Review ${escape(config.network)} transfer</h3><p>Chain ID: ${config.chainId}</p><code>To: ${to}</code>${token ? `<p>Contract: <code>${token.address}</code></p>` : ''}<p>Amount: ${escape(formatUnits(amount, token?.decimals ?? 18))} ${escape(token?.symbol || 'ETH')}</p><p>Maximum execution fee: ${formatEther(BigInt(tx.gasLimit) * fees.maxFeePerGas)} ETH. L2 chains may charge additional data fees.</p><p>Test assets only. Token labels are unverified. Review expires in two minutes.</p><label class="check"><input id="evm-ack" type="checkbox"> I checked the full recipient, contract and selected test network.</label><button id="evm-confirm" type="button" class="primary">Sign & send test transfer</button><button id="evm-cancel" type="button" class="quiet">Cancel</button></div>`;
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
      const signer = wallet.connect(provider), populated = await signer.populateTransaction(r.tx);
      fresh();
      const raw = await signer.signTransaction(populated);
      fresh(); assertSignedMatchesReview(raw, { ...r.tx, nonce: populated.nonce }, owner, chainId);
      await networkCheck(); fresh();
      const entry: TokenSubmission = { hash: keccak256(raw), contract: r.token?.address || ZeroAddress, to: r.to, amount: String(r.amount), decimals: r.token?.decimals ?? 18, symbol: r.token?.symbol || 'ETH', timestamp: new Date().toISOString(), status: 'unknown', nonce: populated.nonce ?? undefined };
      await submitTracked(raw, entry, record, signed => provider.broadcastTransaction(signed), current);
      if (current()) { history(); notice('Submitted. Check the explorer and refresh before making another transfer.'); }
    });
  }
  function paint() {
    review = undefined; revision++;
    const list = tokens();
    host.innerHTML = `<p id="evm-notice" class="hint" role="status">Loading ${escape(config.network)}…</p>
      <section class="balance-card"><div class="eyebrow">${escape(config.network)} · CHAIN ${config.chainId}</div><h2 id="evm-balance">— ETH</h2><p>Uses your selected Ethereum account address. Balances and contracts are separate on each chain.</p><div class="balance-actions"><button id="evm-refresh" type="button" class="quiet">Refresh</button><button id="evm-privacy" type="button" class="quiet">Hide balances</button></div></section>
      <div class="wallet-grid" style="margin-top:24px"><section class="card"><h2>Send crypto</h2><form id="evm-send"><label for="evm-asset">Asset on ${escape(config.network)}</label><select id="evm-asset"><option value="native">ETH · native gas token</option>${list.map(token => `<option value="${token.address}">${escape(token.symbol)} · ${token.address.slice(0, 8)}…${token.address.slice(-6)}</option>`).join('')}</select><label for="evm-to">Recipient address</label><input id="evm-to" required autocomplete="off" placeholder="0x…" maxlength="42"><label for="evm-amount">Amount</label><input id="evm-amount" required inputmode="decimal" autocomplete="off" maxlength="120"><button class="primary">Review transfer</button></form><div id="evm-review"></div></section>
      <section class="card"><h2>Receive crypto</h2><p>${escape(config.network)} only · same EVM address, different network</p><canvas id="evm-qr" aria-label="Selected testnet receive address QR"></canvas><code class="multi-address">${owner}</code><button id="evm-copy" type="button" class="quiet">Copy address</button><p>Choose this exact network at the sender. Adding a token does not bridge funds.</p><a href="${config.explorer}/address/${owner}" target="_blank" rel="noopener noreferrer">View account on explorer ↗</a></section></div>
      <section class="card" style="margin-top:24px"><h2>Tokens on ${escape(config.network)}</h2><p>Add a standard ERC-20 contract deployed on this testnet. USDT/USDC labels can be copied by anyone; verify the address with its issuer. Native SOL belongs to Solana. Wrapped assets here are separate contracts.</p><form id="evm-import"><label for="evm-contract">Token contract address</label><input id="evm-contract" required autocomplete="off" placeholder="0x…" maxlength="42"><button class="quiet">Import token</button></form><div>${list.map(token => `<div class="asset-row"><div><strong>${escape(token.symbol)}</strong><p>${escape(token.name)} · unverified</p><code>${token.address}</code></div><strong data-evm-balance="${token.address}">Loading…</strong><button type="button" class="quiet" data-evm-remove="${token.address}">Remove tracking</button></div>`).join('') || '<p>No imported tokens for this account and network.</p>'}</div></section>
      <section class="card activity-workspace" style="margin-top:24px"><h2>Local transfer history</h2><p>Transfers submitted from this browser only. Incoming transfers and transfers from other wallets are available on the explorer. Unknown does not mean failed; never retry automatically.</p><div id="evm-history"></div></section>`;
    $('refresh').onclick = () => { void run(refresh); };
    $('privacy').onclick = () => { session.toggleHidden(); amounts(); history(); };
    $('copy').onclick = () => { void run(async () => { await navigator.clipboard.writeText(owner); notice('Public address copied.'); }); };
    $('import').onsubmit = event => { event.preventDefault(); void run(importToken); };
    $('send').onsubmit = event => { event.preventDefault(); void run(prepare); };
    const invalidate = () => { revision++; review = undefined; $('review').replaceChildren(); };
    $('send').addEventListener('input', invalidate); $('send').addEventListener('change', invalidate);
    host.querySelectorAll<HTMLButtonElement>('[data-evm-remove]').forEach(button => button.onclick = () => {
      const address = button.dataset.evmRemove;
      localStorage.setItem(evmTokenKey(network, owner), JSON.stringify(tokens().filter(token => token.address !== address)));
      paint();
    });
    const summary = $('balance').closest<HTMLElement>('section')!;
    const transfer = $('send').closest<HTMLElement>('.wallet-grid')!;
    const inventory = $('import').closest<HTMLElement>('section')!;
    const activity = $('history').closest<HTMLElement>('section')!;
    transfer.classList.add('native-transfer-grid'); inventory.classList.add('asset-inventory');
    summary.hidden = !['overview', 'portfolio'].includes(session.page);
    transfer.hidden = !['overview', 'transfer', 'tokens'].includes(session.page);
    inventory.hidden = !['overview', 'portfolio', 'tokens'].includes(session.page);
    activity.hidden = !['overview', 'activity'].includes(session.page);
    amounts(); try { history(); } catch (error) { notice((error as Error).message, true); }
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
  paint(); void run(refresh);
  return () => { disposed = true; revision++; review = undefined; window.removeEventListener('storage', changed); provider.destroy(); };
}

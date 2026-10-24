import { enhanceCards, mountEntryTabs } from './ui-panels';
import { networkAsset, networkHeading, usesNativeWorkspace, supportsPage, savedNetwork, type NetworkId } from './network-context';
import { preserveImportedWallet, savedWalletLabel } from './wallet-migration';
import { ledgerMarkup, mountLedger } from './ledger';
import { walletErrorMessage } from './error-message';
import { filterLoadedActivity } from './activity-filter';
import { backupStage, recordBackup, backupGuidance } from './backup-status';
import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import { nativeJournalKey, parseJournal, type TokenSubmission } from './token-journal';
import { watchMarkup, mountWatch, watchReadApi } from './watch-only';
import { contactsMarkup, mountContacts, contactOptions, loadContacts, contactNotice, contactsKey } from './contacts';
import { verifyBackup, changePassword, commitPassword } from './recovery';
import { tokensMarkup, mountTokens, mountTokenSummary } from './tokens';
import { mountPortfolioValue } from './portfolio-value';
import { assertFreshReview, assertSignedMatchesReview, recipientNotice } from './transfer-safety';
import { marketMarkup, mountMarket } from './market';
import { Wallet, HDNodeWallet, JsonRpcProvider, formatEther, keccak256, ZeroAddress, type TransactionRequest } from 'ethers';
import QRCode from 'qrcode';
import { VAULT_KEY, CHAIN_ID, validatePassword, transferInput, requireSepolia, affordable, importPhrase } from './wallet';
import { fetchActivity, historyKey, mergeActivity, type Activity } from './activity';
import './style.css';
import { cachedActivity, validateKeystore, restoreBackup } from './security';

type LocalWallet = Wallet | HDNodeWallet;
const root = document.querySelector<HTMLDivElement>('#app')!;
const rpc = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const provider = new JsonRpcProvider(rpc);
let active: LocalWallet | null = null;
let pending: TransactionRequest | null = null;
let pendingReviewedAt = 0;
let busy = false;
let generation = 0;
let idle: ReturnType<typeof setTimeout>;
let balance = '—';
let exactBalance: bigint | null = null;
let notice = '';
let history: Activity[] = [];
let view = 'overview';
let selectedNetwork: NetworkId = savedNetwork(localStorage.getItem('forma.network.v1'));
let disposeMarket: (() => void) | undefined;
let disposePortfolio: (() => void) | undefined;
let disposeTokens: (() => void) | undefined;
let disposeLedger: (() => void) | undefined;
let disposeMulti: (() => void) | undefined;
let disposeWatch: (() => void) | undefined;
let disposeTokenSummary: (() => void) | undefined;
let historyNotice = 'Refresh to load on-chain activity.';
let cursors: [Record<string, string | number> | null, Record<string, string | number> | null] = [null, null];
const WALLET_LIST = 'forma.sepolia.wallets.v1';
let revealTimer: ReturnType<typeof setTimeout>;
let sidebarCollapsed = localStorage.getItem('forma.sidebar.collapsed') === 'true';
let mobileMenuOpen = false;
let activityFilter = 'all';
let activityQuery = '';
let activityStatus = 'all';
let amountsHidden = localStorage.getItem('forma.amounts.hidden') === 'true';
let sendRevision = 0;
type Theme = 'system' | 'light' | 'dark';
let theme: Theme = (['system', 'light', 'dark'].includes(localStorage.getItem('forma.theme') || '') ? localStorage.getItem('forma.theme') : 'system') as Theme;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = theme === 'system' ? (systemTheme.matches ? 'dark' : 'light') : theme;
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
}
systemTheme.addEventListener('change', applyTheme);
applyTheme();

function updateAmountVisibility() {
  const value = document.getElementById('balance-value');
  if (value) { value.textContent = amountsHidden ? '••••••' : balance; value.setAttribute('aria-label', amountsHidden ? 'Balance hidden' : `${balance} ETH`); }
  const toggle = document.getElementById('amount-visibility');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(amountsHidden));
    toggle.setAttribute('aria-label', amountsHidden ? 'Show balance' : 'Hide balance');
    toggle.textContent = amountsHidden ? 'Show balance' : 'Hide balance';
  }
  document.getElementById('portfolio-panel')?.dispatchEvent(new Event('portfolio-privacy-change'));
  const totals = portfolioTotals();
  for (const [id, text] of [['portfolio-balance', exactBalance == null ? '—' : formatEther(exactBalance)], ['portfolio-received', formatEther(totals.received)], ['portfolio-sent', formatEther(totals.sent)]]) {
    const el = document.getElementById(id);
    if (el) el.textContent = amountsHidden ? '••••••' : text;
  }
  const portfolioToggle = document.getElementById('portfolio-privacy');
  if (portfolioToggle) { portfolioToggle.textContent = amountsHidden ? 'Show holdings' : 'Hide holdings'; portfolioToggle.setAttribute('aria-pressed', String(amountsHidden)); }
}
const pages: Record<string, { title: string; subtitle: string; icon: string }> = {
  tokens: { title: 'More assets. Same wallet.', subtitle: 'Track and transfer ERC-20 tokens on Ethereum Sepolia.', icon: 'T' },
  portfolio: { title: 'Your portfolio, at a glance.', subtitle: 'Holdings and activity for your current wallet.', icon: '◈' },
  overview: { title: 'Your money. Your move.', subtitle: 'A simple home for your digital assets.', icon: '▦' },
  market: { title: 'A closer look at Ethereum.', subtitle: 'Live ETH/USDT prices and historical candles.', icon: '$' },
  transfer: { title: 'Send & receive.', subtitle: 'Move test ETH on Ethereum Sepolia.', icon: '↗' },
  activity: { title: 'Every move, in view.', subtitle: 'Your incoming and outgoing Sepolia activity.', icon: '◷' },
  ledger: { title: 'Sign on your device.', subtitle: 'Ledger hardware signing for Sepolia ETH.', icon: 'L' },
  watch: { title: 'Follow an address.', subtitle: 'Read-only tracking. No keys required.', icon: 'W' },
  contacts: { title: 'Know your recipient.', subtitle: 'Addresses you have personally confirmed.', icon: '@' },
  settings: { title: 'Your keys. Your control.', subtitle: 'Manage recovery, backups and saved wallets.', icon: '⌑' },
};

function updateSidebar() {
  root.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  root.classList.toggle('mobile-menu-open', mobileMenuOpen);
  const toggle = document.getElementById('sidebar-toggle');
  toggle?.setAttribute('aria-expanded', String(!sidebarCollapsed));
  toggle?.setAttribute('aria-label', sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
  if (toggle) toggle.textContent = sidebarCollapsed ? '»' : '«';
  document.getElementById('mobile-menu-toggle')?.setAttribute('aria-expanded', String(mobileMenuOpen));
  document.getElementById('sidebar-backdrop')?.setAttribute('tabindex', mobileMenuOpen ? '0' : '-1');
  const sidebar = document.getElementById('wallet-sidebar');
  if (sidebar) sidebar.inert = window.matchMedia('(max-width: 650px)').matches && !mobileMenuOpen;
}
window.addEventListener('resize', updateSidebar);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileMenuOpen) { mobileMenuOpen = false; updateSidebar(); document.getElementById('mobile-menu-toggle')?.focus(); }
});

function vaults(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(WALLET_LIST) || '{}'); } catch { return {}; }
}
function saveVault(json: string, address: string) {
  const saved = vaults();
  const old = localStorage.getItem(VAULT_KEY);
  if (old) {
    const priorAddress = JSON.parse(old).address;
    if (typeof priorAddress === 'string') saved[priorAddress.toLowerCase().replace(/^0x/, '')] = old;
  }
  saved[address.toLowerCase().replace(/^0x/, '')] = json;
  // Archive first so importing cannot discard the existing wallet.
  localStorage.setItem(WALLET_LIST, JSON.stringify(saved));
  localStorage.setItem(VAULT_KEY, json);
}
function loadHistory() {
  try { history = cachedActivity(JSON.parse(localStorage.getItem(historyKey(active!.address)) || '[]')); } catch { history = []; }
  cursors = [null, null];
}
function persistHistory() { if (active) localStorage.setItem(historyKey(active.address), JSON.stringify(history)); }
function clearSecrets() { clearTimeout(revealTimer); document.getElementById('phrase-display')?.replaceChildren(); }
function navigate(next: string) { if (next === 'multi') next = 'overview'; generation++; clearSecrets(); pending = null; view = next; render(); }

function nativeSubmissions(address: string) {
  try { return parseJournal(JSON.parse(localStorage.getItem(nativeJournalKey(address)) || '[]')); } catch { return []; }
}
function nativeSubmissionRows() {
  if (!active) return '';
  return nativeSubmissions(active.address).map(row=>`<div class="history-row"><span class="asset-avatar" aria-hidden="true">↗</span><div class="history-identity"><strong>Sent ETH</strong><p>${escape(submissionDetail(row))}</p><code>To: ${row.to}</code><a href="https://sepolia.etherscan.io/tx/${row.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${amountsHidden?'••••••':escape(formatEther(row.amount))} ETH</strong><span class="status-chip status-${row.status}">${row.status}</span></div></div>`).join('') || '<div class="empty"><h3>No matching submissions</h3><p>Your transfers from this browser will appear here.</p></div>';
}
async function syncHistory(more = false) {
  if (!active) return;
  const address = active.address;
  const version = generation;
  requireSepolia((await provider.getNetwork()).chainId);
  const result = await Promise.allSettled([0, 1].map(i => more && !cursors[i] ? Promise.resolve(null) : fetchActivity(address, i === 1, more ? cursors[i]! : undefined)));
  if (version !== generation || active?.address !== address) return;
  let failures = 0;
  result.forEach((r, i) => {
    if (r.status === 'rejected') { failures++; return; }
    if (!r.value) return;
    history = mergeActivity(history, r.value.items);
    cursors[i] = r.value.cursor;
  });
  // Reconcile locally submitted transactions even if the indexer has not caught up.
  await Promise.all(history.filter(t => t.status === 'pending').map(async t => {
    try {
      const receipt = await provider.getTransactionReceipt(t.hash);
      if (receipt) t.status = receipt.status === 1 ? 'confirmed' : 'failed';
    } catch { /* keep pending until the next refresh */ }
  }));
  if (version !== generation) return;
  const inspected = await inspectSubmissions(nativeSubmissions(address), {
    receipt: hash => provider.getTransactionReceipt(hash), height: () => provider.getBlockNumber(),
    transaction: hash => provider.getTransaction(hash), minedNonce: () => provider.getTransactionCount(address, 'latest'),
  });
  if (version !== generation || active?.address !== address) return;
  const updates = new Map(inspected.map(row => [row.hash, row]));
  localStorage.setItem(nativeJournalKey(address), JSON.stringify(nativeSubmissions(address).map(row => updates.get(row.hash) ?? row)));
  persistHistory();
  historyNotice = failures ? 'Some history could not be loaded. Showing cached and available results; try Refresh.' : 'Synced with Sepolia Blockscout. Includes direct transactions and internal ETH transfers. Tokens are not included.';
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const field = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;

function lock() {
  exactBalance = null;
  mobileMenuOpen = false;
  clearSecrets();
  generation++;
  active = null;
  pending = null;
  balance = '—';
  history = [];
  activityQuery = '';
  activityStatus = 'all';
  view = 'overview';
  clearTimeout(idle);
  notice = 'Wallet locked. Unlock with your local password.';
  render();
}

function portfolioTotals() {
  let received = 0n, sent = 0n;
  const address = active?.address.toLowerCase();
  for (const t of history) {
    if (t.status !== 'confirmed') continue;
    const from = t.from.toLowerCase() === address, to = t.to.toLowerCase() === address;
    if (from && !to) sent += BigInt(t.value);
    if (to && !from) received += BigInt(t.value);
  }
  return { received, sent };
}

function portfolio() {
  return `<section id="portfolio-panel"><div class="portfolio-grid"><section class="balance-card"><div class="eyebrow">TOTAL HOLDINGS <button id="portfolio-privacy" class="amount-visibility" aria-pressed="${amountsHidden}">Hide holdings</button></div><div class="balance"><span id="portfolio-balance">—</span> <small>ETH</small></div><p>Ethereum Sepolia · Test assets only</p><div class="portfolio-value"><span id="portfolio-usd">Loading USD price...</span><small> Hypothetical USD value</small></div><p>Simulation only: test ETH has no actual USD value. The estimate uses real Coinbase ETH/USD prices.</p><button class="primary" id="portfolio-receive">Receive test ETH</button></section><section class="card"><div class="eyebrow">SUPPORTED ASSETS</div><h2>One network.<br>Your own keys.</h2><p>This view values Sepolia ETH and ERC-20 tokens. Use the network selector for your Bitcoin Testnet and Solana Devnet accounts; their balances are not included in this Ethereum estimate.</p><button class="quiet" id="portfolio-refresh">Refresh portfolio</button></section></div>
  <section class="card portfolio-assets"><div class="section-heading"><h2>Assets</h2><span class="pill">Ethereum Sepolia</span></div><div class="asset-row"><div class="asset-symbol">Ξ</div><div><strong>Ethereum</strong><p>Sepolia ETH</p></div><div class="asset-network"><strong>Testnet</strong><p>No monetary value</p></div><button id="portfolio-send" class="quiet">Send ETH</button></div><p class="hint">Your current native ETH balance appears above. USD figures below are hypothetical reference values, not redeemable funds or investment returns.</p></section>
  <section class="card portfolio-assets" id="token-assets-summary"></section><button class="quiet" id="portfolio-tokens">Manage ERC-20 tokens</button><section class="card portfolio-performance"><div class="eyebrow">HYPOTHETICAL UNREALIZED GAIN / LOSS</div><h2 id="portfolio-pnl">Loading deposit prices...</h2><p id="portfolio-since">Finding earliest loaded deposit...</p><p id="portfolio-basis"></p><p class="hint">Weighted-average deposit-minute USD price; withdrawals reduce the remaining basis proportionally. Gas, realized returns and external acquisition costs are excluded. Estimates use loaded history and may be incomplete.</p><p id="portfolio-price-source" class="hint"></p></section><section class="card portfolio-deposits"><h2>Deposit valuation history</h2><p class="hint">Latest 25 loaded deposits. Each compares the deposit-minute ETH/USD open with today's quote for that original amount, even if some ETH was later sent.</p><div id="portfolio-deposit-history"></div></section><div class="portfolio-grid portfolio-flow"><section class="card"><div class="eyebrow">RECEIVED · LOADED HISTORY</div><h2><span id="portfolio-received">—</span> ETH</h2><p>Confirmed incoming transfers, excluding self-transfers.</p></section><section class="card"><div class="eyebrow">SENT · LOADED HISTORY</div><h2><span id="portfolio-sent">—</span> ETH</h2><p>Confirmed outgoing transfers, excluding network fees and self-transfers.</p></section></div><p class="hint">Flow totals use ${history.length} locally loaded records, including internal transfers. They are not lifetime totals or a profit/loss calculation. Load older records under Activity to extend coverage.</p><button id="portfolio-activity" class="quiet">View transaction history</button></section>`;
}
function touch() {
  clearTimeout(idle);
  if (active) idle = setTimeout(lock, 5 * 60 * 1000);
}
document.addEventListener('pointerdown', touch);
document.addEventListener('keydown', touch);
document.addEventListener('visibilitychange', () => { if (document.hidden && (active || busy)) lock(); });
window.addEventListener('pagehide', () => { if (active || busy) lock(); });
window.addEventListener('storage', event => { if ((event.key === VAULT_KEY || (active && event.key === contactsKey(active.address)) || event.key === null) && (active || busy)) lock(); });

function render() {
  disposeMarket?.(); disposeMarket = undefined;
  disposePortfolio?.(); disposePortfolio = undefined;
  disposeTokens?.(); disposeTokens = undefined;
  disposeLedger?.(); disposeLedger = undefined;
  disposeMulti?.(); disposeMulti = undefined;
  disposeWatch?.(); disposeWatch = undefined;
  disposeTokenSummary?.(); disposeTokenSummary = undefined;
  root.dataset.page=view; root.dataset.network=selectedNetwork;
  root.classList.toggle('wallet-locked', !active);
  root.classList.toggle('is-entry', !active && view === 'overview');
  root.classList.toggle('is-ledger', view === 'ledger');
  const hasVault = !!localStorage.getItem(VAULT_KEY);
  const page = pages[view] || pages.overview;
  const native = !!active && usesNativeWorkspace(selectedNetwork, view);
  const available = supportsPage(selectedNetwork, view);
  const asset = networkAsset(selectedNetwork);
  const title = active && ['overview','portfolio','transfer','activity','market','tokens','contacts','watch'].includes(view) ? networkHeading(selectedNetwork, view) : page.title;
  const subtitle = view === 'market' ? `Live ${asset.symbol}/USDT prices and historical candles.` : native ? `${asset.network} · Native ${asset.symbol} accounts from your wallet recovery phrase.` : page.subtitle;
  const content = !available ? `<section class="card"><h2>${asset.name}: feature unavailable</h2><p>This feature is supported on Ethereum Sepolia only. Native ${asset.symbol} receive, send, activity and market are available from the navigation.</p></section>`
    : active && view === 'market' ? marketMarkup(selectedNetwork)
    : native ? `${view === 'overview' ? networkAccountsMarkup() : ''}<section id="multi-panel" class="multichain-workspace"><p role="status">Opening selected network…</p></section>`
    : selectedNetwork !== 'eth' && ['watch','contacts'].includes(view) ? `<section id="${view === 'watch' ? 'watch-panel' : 'contacts-panel'}" class="card">Loading network accounts…</section>`
    : view === 'ledger' ? ledgerMarkup() : view === 'watch' ? watchMarkup()
    : active ? selectedNetwork !== 'eth' ? settings() : dashboard() + portfolio() + tokensMarkup() + marketMarkup('eth') + settings() + contactsMarkup(active.address)
    : onboarding(hasVault);

  root.innerHTML = `<button id="sidebar-backdrop" aria-label="Close navigation" tabindex="-1"></button><aside id="wallet-sidebar"><a class="brand" href="/">◈ <span>forma</span></a><button id="sidebar-toggle" class="sidebar-toggle" aria-controls="wallet-sidebar" title="Toggle sidebar"></button><div class="workspace">PERSONAL WALLET</div><nav aria-label="Wallet navigation">${[['overview','Overview'],['portfolio','Portfolio'],['tokens','Tokens'],['transfer','Send & receive'],['market','Market'],['activity','Activity'],['ledger','Ledger'],['watch','Watch-only'],['contacts','Contacts'],['settings','Recovery & import']].map(([id,label]) => `<button data-view="${id}" title="${supportsPage(selectedNetwork, id) ? label : label + ' (Ethereum only)'}" aria-label="${label}" ${(!active && id !== 'overview') || !supportsPage(selectedNetwork, id) ? 'disabled' : ''} class="${view === id ? 'selected' : ''}" aria-current="${view === id ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${pages[id].icon}</span><span class="nav-label">${label}</span></button>`).join('')}</nav><div class="aside-bottom"><span class="dot"></span> Your keys. Your control.<small>Self-custody, by design.</small></div></aside>
    <main><header><a href="/" class="entry-brand" aria-label="Forma home"><span aria-hidden="true">&#9672;</span> forma<span class="brand-caption">YOUR PERSONAL WALLET</span></a><button id="mobile-menu-toggle" class="quiet" aria-label="Open navigation" aria-controls="wallet-sidebar">&#9776;</button><div class="crumb">My wallet <span>/</span> ${view === 'multi' ? 'Bitcoin & Solana' : view === 'overview' ? 'Overview' : view === 'transfer' ? 'Send & receive' : view === 'activity' ? 'Activity' : view === 'market' ? 'Market' : view === 'portfolio' ? 'Portfolio' : view === 'tokens' ? 'Tokens' : view === 'contacts' ? 'Contacts' : view === 'watch' ? 'Watch-only' : view === 'ledger' ? 'Ledger' : 'Recovery & import'}</div><div class="header-tools"><label class="theme-control" for="theme-select"><span>Appearance</span><select id="theme-select" aria-label="Appearance">${['system','light','dark'].map(t => `<option value="${t}" ${theme === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label>${active ? `<label class="network-control" for="network-select"><span>Network</span><select id="network-select" aria-label="Wallet network">${[["eth","Ethereum Sepolia"],["btc","Bitcoin Testnet3"],["sol","Solana Devnet"]].map(([id,label]) => `<option value="${id}" ${id === (selectedNetwork) ? "selected" : ""}>${label}</option>`).join("")}</select></label>` : ''}<div class="network"><span class="dot"></span> ${networkAsset(selectedNetwork).network} <b>TESTNET</b></div></div></header>
    <section class="content"><div class="title-row"><div><div class="eyebrow">A LITTLE MORE OWNERSHIP</div><h1>${title}</h1><p>${subtitle}</p></div>${active ? '<button id="lock" class="quiet">⌑ Lock wallet</button>' : '<span class="pill">◈ Self-custody</span>'}</div>
    <div class="test-banner">◇ <span><strong>You’re on a test network.</strong> Use test tokens only. This prototype has not been audited.</span></div>
    <div id="notice" role="status" aria-live="polite">${escape(notice)}</div>
    ${content}
    <footer class="wallet-footer"><div class="footer-brand"><strong>FORMA</strong><span>Your keys. Your control.</span></div><div class="footer-meta"><span id="footer-network"><i class="dot"></i>${networkAsset(selectedNetwork).network}</span><span>Self-custody</span><span class="footer-version">Prototype v0.1</span></div></footer></section></main>`;
  document.getElementById('lock')?.addEventListener('click', lock);
  bind();
  updateAmountVisibility();
  updateSidebar();
  document.getElementById('sidebar-toggle')!.onclick = () => {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('forma.sidebar.collapsed', String(sidebarCollapsed));
    updateSidebar();
  };
  document.getElementById('mobile-menu-toggle')!.onclick = () => { mobileMenuOpen = !mobileMenuOpen; updateSidebar(); if (mobileMenuOpen) root.querySelector<HTMLButtonElement>('[data-view]:not(:disabled)')?.focus(); };
  document.getElementById('sidebar-backdrop')!.onclick = () => { mobileMenuOpen = false; updateSidebar(); document.getElementById('mobile-menu-toggle')?.focus(); };
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.onclick = () => { mobileMenuOpen = false; navigate(button.dataset.view!); });
  const groups = ['wallet-summary', 'transfer-panels', 'activity-panel', 'settings-panel', 'market-panel', 'portfolio-panel', 'tokens-panel', 'contacts-panel', 'watch-panel', 'ledger-panel', 'network-accounts'];
  const visible = view === 'overview' ? [...groups.slice(0, 3), 'network-accounts'] : view === 'transfer' ? ['transfer-panels'] : view === 'activity' ? ['activity-panel'] : view === 'market' ? ['market-panel'] : view === 'portfolio' ? ['portfolio-panel'] : view === 'tokens' ? ['tokens-panel'] : view === 'contacts' ? ['contacts-panel'] : view === 'watch' ? ['watch-panel'] : view === 'ledger' ? ['ledger-panel'] : ['settings-panel'];
  groups.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = !visible.includes(id); });
  if (selectedNetwork === 'eth' && active && view === 'portfolio') disposePortfolio = mountPortfolioValue(document.getElementById('portfolio-panel')!, history, active.address, exactBalance, () => amountsHidden);
  if (selectedNetwork === 'eth' && active && view === 'tokens') { const wallet = active; const version = generation; disposeTokens = mountTokens(document.getElementById('tokens-panel')!, provider, wallet, () => active === wallet && version === generation, () => amountsHidden); }
  if (selectedNetwork === 'eth' && active && view === 'portfolio') disposeTokenSummary = mountTokenSummary(document.getElementById('token-assets-summary')!, provider, active.address, () => amountsHidden);
  document.getElementById('open-ledger')?.addEventListener('click', () => { selectedNetwork = 'eth'; notice = 'Hardware wallet mode. Your local wallet remains locked.'; navigate('ledger'); });
  if (native && active && selectedNetwork !== 'eth') {
    const host = document.getElementById('multi-panel')!, version = generation, wallet = active, network = selectedNetwork;
    void import('./multichain').then(module => {
      if (!host.isConnected || version !== generation || selectedNetwork !== network) return;
      disposeMulti = module.mountMulti(host, {
        wallet, chain: network, page: view, current: () => active === wallet && generation === version && selectedNetwork === network,
        lock, backup: downloadWalletBackup, select: () => {},
        hideBalance: () => amountsHidden,
        toggleBalance: () => { amountsHidden = !amountsHidden; localStorage.setItem('forma.amounts.hidden', String(amountsHidden)); updateAmountVisibility(); },
      });
    }).catch(() => { if (host.isConnected) host.textContent = 'Unable to load network accounts. Refresh to try again.'; });
  }
  document.getElementById('network-select')?.addEventListener('change', event => {
    const choice = (event.target as HTMLSelectElement).value;
    if (choice === 'eth' || choice === 'btc' || choice === 'sol') { selectedNetwork = choice; localStorage.setItem('forma.network.v1', choice); navigate(supportsPage(choice, view) ? view : 'overview'); }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-account-network]').forEach(button => button.onclick = () => {
    const choice = button.dataset.accountNetwork;
    if (choice === 'eth' || choice === 'btc' || choice === 'sol') { selectedNetwork = choice; localStorage.setItem('forma.network.v1', choice); navigate('overview'); }
  });
  if (available && view === 'ledger') disposeLedger = mountLedger(document.getElementById('ledger-panel')!, provider, () => navigate('overview'));
  document.getElementById('open-watch')?.addEventListener('click', () => { notice = 'Signing wallet remains locked. Watch-only mode needs no unlock.'; navigate('watch'); });
  if (selectedNetwork === 'eth' && available && view === 'watch') disposeWatch = mountWatch(document.getElementById('watch-panel')!, watchReadApi(provider), () => navigate('overview'), () => amountsHidden);
  if (selectedNetwork !== 'eth' && (view === 'watch' || (active && view === 'contacts'))) {
    const network=selectedNetwork, mode=view as 'watch'|'contacts', version=generation, owner=active?.address || '';
    const host=document.getElementById(mode === 'watch' ? 'watch-panel' : 'contacts-panel')!;
    void import('./native-public').then(module => {
      if (generation !== version || !host.isConnected) return;
      disposeWatch=module.mountNativePublic(host,network,mode,owner,()=>amountsHidden);
    }).catch(()=>{ if(host.isConnected) host.textContent='Network accounts could not load. Refresh to retry.'; });
  }
  if (selectedNetwork === 'eth' && active && view === 'contacts') mountContacts(active.address, render, text => { notice = text; const el = document.getElementById('notice'); if (el) el.textContent = text; });
  if (active && view === 'market') disposeMarket = mountMarket(document.getElementById('market-panel')!, selectedNetwork);
  mountEntryTabs(root); enhanceCards(root);
}

function activityRows() {
  const filtered = filterLoadedActivity(history, active!.address, activityFilter, activityStatus, activityQuery);
  if (!filtered.length) return '<div class="empty"><h3>No matching activity.</h3><p>Clear your search, change the filter, or load more activity. Search covers loaded ETH records only.</p></div>';
  return filtered.map(t => {
    const sent = t.from.toLowerCase() === active!.address.toLowerCase();
    return `<div class="history-row"><span class="asset-avatar" aria-hidden="true">${sent?'↗':'↙'}</span><div class="history-identity"><strong>${sent?'Sent ETH':'Received ETH'}</strong><p>${escape(new Date(t.timestamp).toLocaleString())}${t.kind==='internal'?' · Internal transfer':''}</p><code>${escape(short(sent?t.to||'Contract creation':t.from))}</code><a target="_blank" rel="noopener noreferrer" href="https://sepolia.etherscan.io/tx/${escape(t.hash)}">View transaction ↗</a></div><div class="history-value"><strong><span data-activity-amount="${escape(t.id)}">${amountsHidden?'••••••':escape(formatEther(t.value))}</span> ETH</strong><span class="status-chip status-${escape(t.status)}">${escape(t.status)}</span></div></div>`;
  }).join('');
}

function phraseRestoreForm() { return `<h3>Restore from a recovery phrase</h3><form id="phrase-form"><label for="import-phrase">Recovery phrase</label><input type="password" id="import-phrase" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="12 or 24 words, in order"><label for="seed-passphrase">Optional BIP-39 passphrase (not your wallet password)</label><input type="password" id="seed-passphrase" autocomplete="off"><label for="account-index">Account index (0 for the first account)</label><input id="account-index" type="number" min="0" max="100" value="0" required><p class="hint">Ethereum path m/44'/60'/0'/0/index. Bitcoin and Solana use their fixed first-account paths from the same phrase. Non-empty BIP-39 passphrase imports remain Ethereum-only.</p><label for="new-password">Local encryption password (12+ characters)</label><input id="new-password" type="password" minlength="12" autocomplete="new-password" required><label for="new-confirm">Confirm local password</label><input id="new-confirm" type="password" autocomplete="new-password" required><label class="check"><input type="checkbox" required> This is a test wallet. I understand the imported account may differ if the passphrase or account index is different.</label><button class="primary">Import & switch wallet</button></form>`; }

function savedWalletButtons() {
  const saved = vaults();
  return Object.keys(saved).slice(0,100).map((key,index)=>{
    const current=saved[key]===localStorage.getItem(VAULT_KEY);
    return `<button type="button" class="quiet saved-wallet-choice" data-wallet="${escape(key)}" ${current?'disabled':''}><span class="saved-wallet-icon" aria-hidden="true">◇</span><span class="saved-wallet-identity"><strong>Wallet ${index+1}</strong><small>${escape(savedWalletLabel(key,saved[key]))}</small></span><span class="saved-wallet-state">${current?'Current':'Unlock →'}</span></button>`;
  }).join('') || '<div class="saved-wallet-empty"><span aria-hidden="true">◇</span><strong>No other wallets saved</strong><p>Restored wallets will appear here. Each keeps its own local password.</p></div>';
}

function settings() {
  const saved = vaults();
  const current = active!.address.toLowerCase().replace(/^0x/, '');
  return `<section id="settings-panel" class="card"><h2>Recovery & import</h2><p>For phrase-backed wallets, this encrypted backup restores your Ethereum, Bitcoin Testnet and Solana Devnet accounts. Imported Ethereum keys without a phrase remain Ethereum-only.</p><p>Only use fresh test wallets here. Importing preserves the current encrypted wallet.</p>
  <h3>Recovery phrase</h3><p>Your recovery phrase controls this wallet on every compatible network. Keep it offline and never share it.</p>
  <form id="reveal-form"><label for="reveal-password">Re-enter this wallet’s password</label><input type="password" id="reveal-password" autocomplete="current-password" required><button class="quiet">Reveal recovery phrase for 30 seconds</button></form><div id="phrase-display" aria-live="off"></div>
  ${phraseRestoreForm()}
  <h3>Import an encrypted JSON backup</h3><form id="import-form"><label for="keystore">Encrypted keystore JSON</label><input id="keystore" type="file" accept=".json,application/json" required><label for="import-password">Backup password</label><input id="import-password" type="password" autocomplete="current-password" required><label for="backup-local-password">New local password (12+ characters)</label><input id="backup-local-password" type="password" minlength="12" autocomplete="new-password" required><label for="backup-local-confirm">Confirm new local password</label><input id="backup-local-confirm" type="password" autocomplete="new-password" required><button class="quiet">Import encrypted backup</button></form>
  <h3>Verify your backup</h3><p>Decrypt a downloaded backup and check its address against this wallet. Verification does not switch wallets.</p><form id="verify-backup-form"><label for="verify-backup-file">Backup JSON to verify</label><input id="verify-backup-file" type="file" accept=".json,application/json" required><label for="verify-backup-password">Password for this backup</label><input id="verify-backup-password" type="password" autocomplete="off" required><button class="quiet">Verify backup</button></form>
  <h3>Change wallet password</h3><p>Changes local encryption for this wallet only. Previously downloaded backups still use their original passwords. Download and verify a new backup afterwards.</p><form id="change-password-form"><label for="change-old-password">Current local password</label><input id="change-old-password" type="password" autocomplete="current-password" required><label for="change-new-password">New wallet password (12+ characters)</label><input id="change-new-password" type="password" minlength="12" autocomplete="new-password" required><label for="change-confirm-password">Confirm new wallet password</label><input id="change-confirm-password" type="password" autocomplete="new-password" required><button class="quiet">Change password & lock</button></form>
  <h3>Saved wallets</h3><p>Switching locks the active wallet. Unlock the selected wallet with its own password.</p><div class="saved-wallets">${savedWalletButtons()}</div></section>`;
}

function onboarding(hasVault: boolean) {
  return `<div class="setup-grid auth-shell"><section class="card setup auth-card"><div class="auth-card-top"><span class="auth-lock" aria-hidden="true">&#9635;</span><span class="auth-local">LOCAL WALLET</span></div><div class="icon-large" hidden>◈</div><div class="eyebrow">YOUR OWN SPACE</div><h1>${hasVault ? 'Welcome back.' : 'Start with ownership.'}</h1><p>${hasVault ? 'Unlock the wallet saved on this browser.' : 'Create a fresh test wallet. Your keys are encrypted on this device with a password only you know.'}</p>
  <form id="vault-form"><label for="password">${hasVault ? 'Wallet password' : 'Create a password'}</label><input id="password" type="password" minlength="12" required autocomplete="${hasVault ? 'current-password' : 'new-password'}" placeholder="Enter your wallet password"><p class="auth-input-hint">Your password unlocks this device only.</p>
  ${hasVault ? '' : '<label for="confirm">Confirm password</label><input id="confirm" type="password" required autocomplete="new-password" placeholder="Enter your password again"><label class="check"><input id="understand" type="checkbox" required> I will download my encrypted backup. There is no password reset.</label>'}
  <button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Working securely…' : hasVault ? 'Unlock wallet →' : 'Create test wallet →'}</button></form><div class="auth-encryption-note"><span aria-hidden="true">&#9671;</span> Encrypted locally. Your keys stay with you.</div><div class="auth-alternatives"><span>OTHER WAYS TO EXPLORE</span><button id="open-ledger" class="auth-option"><span class="auth-option-icon" aria-hidden="true">&#9636;</span><span><strong>Connect a Ledger</strong><small>Approve on your device</small></span><span aria-hidden="true">&#8599;</span></button><button id="open-watch" class="auth-option"><span class="auth-option-icon" aria-hidden="true">&#9678;</span><span><strong>Watch an address</strong><small>Explore without importing keys</small></span><span aria-hidden="true">&#8599;</span></button></div>
  <p class="hint">One wallet and backup for Ethereum, Bitcoin Testnet and Solana Devnet.</p>${'<details class="auth-disclosure restore-backup"><summary><span class="disclosure-icon" aria-hidden="true">↥</span><span><strong>Restore from a backup</strong><small>Import your encrypted wallet JSON</small></span></summary><p class="hint">Choose your encrypted backup and enter its original password. Set a password for this browser.</p><form id="import-form"><label for="keystore">Encrypted keystore JSON</label><input id="keystore" type="file" accept=".json,application/json" required><label for="import-password">Backup password</label><input id="import-password" type="password" required autocomplete="current-password"><label for="backup-local-password">New local password (12+ characters)</label><input id="backup-local-password" type="password" minlength="12" autocomplete="new-password" required><label for="backup-local-confirm">Confirm new local password</label><input id="backup-local-confirm" type="password" autocomplete="new-password" required><button class="quiet" '+(busy ? 'disabled' : '')+'>Restore encrypted wallet →</button></form></details>'}<details class="restore-phrase auth-disclosure"><summary><span class="disclosure-icon" aria-hidden="true">◇</span><span><strong>Restore with a recovery phrase</strong><small>Use the words from your test wallet</small></span></summary>${phraseRestoreForm()}</details><details class="auth-disclosure"><summary><span class="disclosure-icon" aria-hidden="true">▤</span><span><strong>Saved wallets</strong><small>Switch to a wallet stored on this browser</small></span></summary><p class="hint">Switching locks the current session. Use the selected wallet’s password to unlock it.</p><div class="saved-wallets">${savedWalletButtons()}</div></details></section>
  <section class="intro auth-story"><div class="eyebrow">A LITTLE MORE OWNERSHIP</div><h2>Your wallet.<br><span>Your way.</span></h2><p>A calm place for your digital assets.<br>Built around one simple idea: you hold the keys.</p><div class="auth-art" aria-hidden="true"><div class="auth-orbit orbit-one"></div><div class="auth-orbit orbit-two"></div><div class="auth-vault"><div class="auth-vault-brand">&#9672; forma</div><span>SELF-CUSTODY</span><div class="auth-key">&#9671;</div><div class="auth-vault-bottom"><span>YOUR KEYS</span><span>YOUR CONTROL</span></div></div><div class="auth-art-tag"><i class="dot"></i> On your device</div></div><div class="auth-promises"><div><b>01</b><strong>Created by you</strong><p>Keys generated locally.</p></div><div><b>02</b><strong>Protected locally</strong><p>An encrypted local vault.</p></div><div><b>03</b><strong>Recovered by you</strong><p>Your backup. Your access.</p></div></div><p class="auth-story-note">Testnet wallet prototype. Use fresh test wallets only.</p></section></div>`;
}

function networkAccountsMarkup() { return `<section id="network-accounts" class="card"><h2>Your wallet accounts</h2><p>One unlock, one recovery phrase and one encrypted backup for phrase-backed wallets. Each network has its own receiving address.</p><div class="account-network-grid"><button type="button" class="quiet" data-account-network="eth">Ξ Ethereum Sepolia</button><button type="button" class="quiet" data-account-network="btc">₿ Bitcoin Testnet3</button><button type="button" class="quiet" data-account-network="sol">◎ Solana Devnet</button></div></section>`; }

function dashboard() {
  const address = active!.address;
  return `${networkAccountsMarkup()}<div class="wallet-grid" id="wallet-summary"><section class="balance-card"><div class="eyebrow">AVAILABLE BALANCE <button id="amount-visibility" class="amount-visibility" aria-pressed="${amountsHidden}">${amountsHidden ? 'Show balance' : 'Hide balance'}</button></div><div class="balance"><span id="balance-value">${amountsHidden ? '&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;' : escape(balance)}</span> <small>ETH</small></div><p>Sepolia ETH · Test tokens have no monetary value</p><div class="balance-actions"><button id="send-focus" class="primary">↗ Send</button><button id="receive-focus" class="quiet">↙ Receive</button><button id="refresh" class="text-button">↻ Refresh</button></div><div class="address-bar"><span>WALLET ADDRESS</span><code>${short(address)}</code><button id="copy" aria-label="Copy wallet address">⧉</button></div></section>
  <section class="card security"><div class="eyebrow">WALLET HEALTH <span class="dot"></span></div><h2>Keep ownership.<br>Keep a backup.</h2><p>Your encrypted backup and password recover this wallet if this browser’s data is lost.</p><p role="status">${escape(backupGuidance(backupStage(localStorage, active!.address, localStorage.getItem(VAULT_KEY) || '')))}</p><button id="backup" class="quiet">↓ Download encrypted backup</button><button id="backup-verify" class="quiet">Verify a saved backup</button><small>Status is a local reminder, not a guarantee of recovery. Auto-locks after 5 minutes idle or when hidden.</small></section></div>
  <div class="wallet-grid lower" id="transfer-panels"><section class="card" id="send-card"><div class="section-heading"><h2>Send crypto</h2><span>↗</span></div><form id="send-form"><label for="eth-contact">Saved recipient (optional)</label><select id="eth-contact">${contactOptions(active!.address)}</select><label for="recipient">Recipient address</label><input id="recipient" placeholder="0x…" required autocomplete="off"><label for="amount">Amount in Sepolia ETH</label><input id="amount" placeholder="0.00" inputmode="decimal" required autocomplete="off"><p class="hint">Only send on Ethereum Sepolia. Check the full address.</p><button class="primary" ${busy ? 'disabled' : ''}>Review transfer →</button></form><div id="review"></div></section>
  <section class="card" id="receive-card"><div class="section-heading"><h2>Receive crypto</h2><span>↙</span></div><div class="receive"><canvas id="qr"></canvas><strong>Ethereum Sepolia only</strong><code>${address}</code><button id="save-receive-qr" type="button" class="quiet">Save receive QR image</button><p>Share your public address. Never share your password or backup.</p><a href="https://sepolia.etherscan.io/address/${address}" target="_blank" rel="noopener noreferrer">View full activity on explorer ↗</a></div></section></div>
  <section class="card activity activity-workspace" id="activity-panel"><div class="section-heading"><h2>Transaction history</h2><button id="history-refresh" class="quiet">Refresh activity</button></div><div class="activity-toolbar"><div class="filter-tabs" aria-label="Filter activity">${['all','received','sent'].map(filter => `<button data-filter="${filter}" class="${activityFilter === filter ? 'is-active' : ''}" aria-pressed="${activityFilter === filter}">${filter[0].toUpperCase()+filter.slice(1)}</button>`).join('')}</div><span class="activity-count">${history.length} indexed records</span></div><p class="hint">${escape(historyNotice)}</p><h3>Locally submitted ETH</h3><p class="hint">Unknown does not mean failed. Refresh activity to check receipts. Do not retry an uncertain transfer automatically.</p><div id="eth-submissions">${nativeSubmissionRows()}</div><div class="history-controls"><label for="activity-status">Status<select id="activity-status">${["all", "pending", "confirmed", "failed"].map(status => `<option value="${status}" ${activityStatus === status ? "selected" : ""}>${status === "all" ? "All statuses" : status[0].toUpperCase() + status.slice(1)}</option>`).join("")}</select></label><label for="activity-search">Search loaded activity<input id="activity-search" type="search" maxlength="100" autocomplete="off" placeholder="Address or transaction hash" value="${escape(activityQuery)}"></label></div><p class="hint">Searches loaded ETH records only. Load older activity to extend results.</p><div id="activity-search-results">${activityRows()}</div>${cursors.some(Boolean) ? '<button id="load-more" class="quiet">Load older activity</button>' : ''}<p><a href="https://eth-sepolia.blockscout.com/address/${address}" target="_blank" rel="noopener noreferrer">View complete activity on explorer</a></p></section>`;

}

async function task(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  root.setAttribute('aria-busy', 'true');
  root.querySelectorAll<HTMLButtonElement>('form button, #refresh, #history-refresh, #load-more').forEach(b => { b.disabled = true; b.dataset.originalText = b.textContent || ''; b.textContent = 'Working...'; });
  try { await fn(); } catch (error) {
    notice = walletErrorMessage(error);
    const el = document.getElementById('notice');
    if (el) el.textContent = notice;
  } finally {
    busy = false;
    root.removeAttribute('aria-busy');
    root.querySelectorAll<HTMLButtonElement>('form button, #refresh, #history-refresh, #load-more').forEach(b => { b.disabled = false; if (b.dataset.originalText) { b.textContent = b.dataset.originalText; delete b.dataset.originalText; } });
    touch();
  }
}

async function refresh() {
  if (selectedNetwork !== 'eth') return;
  const wallet = active;
  const version = generation;
  if (!wallet) return;
  requireSepolia((await provider.getNetwork()).chainId);
  const amount = await provider.getBalance(wallet.address);
  if (version !== generation) return;
  exactBalance = amount;
  balance = Number(formatEther(amount)).toLocaleString('en-US', { maximumFractionDigits: 8 });
  await syncHistory();
  if (version === generation) render();
}

function downloadWalletBackup() {
  if (!active) return;
    const vault = localStorage.getItem(VAULT_KEY);
    if (!vault) return;
    const url = URL.createObjectURL(new Blob([vault], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'forma-wallet-encrypted-backup.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (active) recordBackup(localStorage, active.address, vault, 'requested');
    render();
}

function bind() {
  document.getElementById('activity-status')?.addEventListener('change', event => {
    activityStatus = (event.target as HTMLSelectElement).value;
    const rows = document.getElementById('activity-search-results');
    if (rows) rows.innerHTML = activityRows();
    updateAmountVisibility();
  });
  document.getElementById('save-receive-qr')?.addEventListener('click', () => void task(async () => {
    if (!active) return;
    const owner = active.address, version = generation;
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, `ethereum:${owner}@${CHAIN_ID}`, { width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#183d35', light: '#ffffff' } });
    const image = document.createElement('canvas');
    image.width = 420; image.height = 500;
    const ctx = image.getContext('2d');
    if (!ctx) throw new Error('QR image unavailable. Copy your public address instead.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 420, 500);
    ctx.textAlign = 'center'; ctx.fillStyle = '#183d35'; ctx.font = 'bold 24px sans-serif';
    ctx.fillText('forma · Receive', 210, 38);
    ctx.font = 'bold 16px sans-serif'; ctx.fillText('Ethereum Sepolia · TESTNET', 210, 68);
    ctx.drawImage(qr, 50, 85);
    ctx.font = '14px monospace'; ctx.fillText(owner.slice(0, 22), 210, 428); ctx.fillText(owner.slice(22), 210, 450);
    ctx.font = '13px sans-serif'; ctx.fillText('Test assets only · Verify network before sending', 210, 480);
    const blob = await new Promise<Blob | null>(resolve => image.toBlob(resolve, 'image/png'));
    if (version !== generation || active?.address !== owner) return;
    if (!blob) throw new Error('QR image unavailable. Copy your public address instead.');
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `forma-sepolia-receive-${owner.slice(-6)}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice = 'QR image download requested. It contains your public address only. Share it for Sepolia test assets.';
    const el = document.getElementById('notice'); if (el) el.textContent = notice;
  }));
  document.getElementById('activity-search')?.addEventListener('input', event => {
    activityQuery = (event.target as HTMLInputElement).value.slice(0, 100);
    const rows = document.getElementById('activity-search-results');
    if (rows) rows.innerHTML = activityRows();
    updateAmountVisibility();
  });
  document.getElementById('backup-verify')?.addEventListener('click', () => { navigate('settings'); document.getElementById('verify-backup-form')?.scrollIntoView({ behavior: 'smooth' }); document.getElementById('verify-backup-file')?.focus(); });
  document.getElementById('portfolio-tokens')?.addEventListener('click', () => navigate('tokens'));
  document.getElementById('portfolio-refresh')?.addEventListener('click', () => void task(refresh));
  document.getElementById('portfolio-receive')?.addEventListener('click', () => { navigate('transfer'); document.getElementById('receive-card')?.scrollIntoView({ behavior: 'smooth' }); });
  document.getElementById('portfolio-send')?.addEventListener('click', () => { navigate('transfer'); document.getElementById('recipient')?.focus(); });
  document.getElementById('portfolio-activity')?.addEventListener('click', () => navigate('activity'));
  document.getElementById('portfolio-privacy')?.addEventListener('click', () => { amountsHidden = !amountsHidden; localStorage.setItem('forma.amounts.hidden', String(amountsHidden)); updateAmountVisibility(); });
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => {
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    input.before(wrapper);
    wrapper.append(input);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-label', `Show ${input.labels?.[0]?.textContent || 'password'}`);
    toggle.setAttribute('aria-controls', input.id);
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.textContent = reveal ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(reveal));
      toggle.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${input.labels?.[0]?.textContent || 'password'}`);
    });
    wrapper.append(toggle);
  });
  document.getElementById('theme-select')?.addEventListener('change', event => {
    theme = (event.target as HTMLSelectElement).value as Theme;
    localStorage.setItem('forma.theme', theme);
    applyTheme();
  });
  document.getElementById('amount-visibility')?.addEventListener('click', () => {
    amountsHidden = !amountsHidden;
    localStorage.setItem('forma.amounts.hidden', String(amountsHidden));
    updateAmountVisibility();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(button => button.onclick = () => { activityFilter = button.dataset.filter!; render(); });
  document.getElementById('history-refresh')?.addEventListener('click', () => void task(async () => { await syncHistory(); render(); }));
  document.getElementById('load-more')?.addEventListener('click', () => void task(async () => { await syncHistory(true); render(); }));
  root.querySelectorAll<HTMLButtonElement>('[data-wallet]').forEach(button => button.onclick = () => {
    if (busy) return;
    const json = vaults()[button.dataset.wallet!];
    if (!json) return;
    localStorage.setItem(VAULT_KEY, json);
    lock();
    notice = 'Selected wallet is locked. Enter its password to unlock.';
    render();
  });
  document.getElementById('verify-backup-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const file = (document.getElementById('verify-backup-file') as HTMLInputElement).files?.[0];
      const password = field('verify-backup-password');
      (document.getElementById('verify-backup-password') as HTMLInputElement).value = '';
      if (!file || file.size > 100000 || !active) throw new Error('Choose a backup smaller than 100 KB.');
      const version = generation, address = active.address;
      const backupJson = await file.text();
      await verifyBackup(backupJson, password, address);
      if (generation !== version || !active) return;
      const currentVault = localStorage.getItem(VAULT_KEY);
      if (currentVault === backupJson) recordBackup(localStorage, address, currentVault, 'verified');
      notice = 'Backup verified: it decrypts successfully and matches this wallet address. Keep the file and its password safe.';
      render();
    });
  });
  document.getElementById('change-password-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      if (!active) return;
      const oldPassword = field('change-old-password'), password = field('change-new-password'), confirmation = field('change-confirm-password');
      for (const id of ['change-old-password', 'change-new-password', 'change-confirm-password']) (document.getElementById(id) as HTMLInputElement).value = '';
      const version = generation, address = active.address, oldJson = localStorage.getItem(VAULT_KEY)!;
      const encrypted = await changePassword(oldJson, oldPassword, password, confirmation, address);
      if (generation !== version || !active) return;
      commitPassword(localStorage, VAULT_KEY, WALLET_LIST, address, oldJson, encrypted);
      lock(); notice = 'Password changed. Unlock with your new password, then download and verify a new backup. Older backups keep their old passwords.'; render();
    });
  });
  document.getElementById('reveal-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      clearSecrets();
      const password = field('reveal-password');
      (document.getElementById('reveal-password') as HTMLInputElement).value = '';
      const version = generation;
      let wallet: LocalWallet;
      try { const json = localStorage.getItem(VAULT_KEY)!; validateKeystore(json); wallet = await Wallet.fromEncryptedJson(json, password); }
      catch { throw new Error('Incorrect wallet password.'); }
      if (version !== generation || !active) return;
      if (!(wallet instanceof HDNodeWallet) || !wallet.mnemonic) throw new Error('This imported keystore has no recovery phrase. Use its encrypted JSON backup to recover it.');
      const target = document.getElementById('phrase-display');
      if (!target || view !== 'settings') return;
      const warning = document.createElement('p'); warning.textContent = 'Write these words down privately. Anyone with them can control this wallet.';
      const phrase = document.createElement('div'); phrase.className = 'seed-words';
      wallet.mnemonic.phrase.split(' ').forEach((word, index) => { const span = document.createElement('span'); span.textContent = `${index + 1}. ${word}`; phrase.append(span); });
      const hide = document.createElement('button'); hide.textContent = 'Hide phrase'; hide.className = 'quiet'; hide.onclick = clearSecrets;
      target.replaceChildren(warning, phrase, hide);
      revealTimer = setTimeout(clearSecrets, 30000);
    });
  });
  document.getElementById('phrase-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const phraseInput = document.getElementById('import-phrase') as HTMLInputElement;
      const passphraseInput = document.getElementById('seed-passphrase') as HTMLInputElement;
      const phrase = phraseInput.value;
      const passphrase = passphraseInput.value;
      // Clear even when validation fails; DOM fields must not retain failed secrets.
      phraseInput.value = '';
      passphraseInput.value = '';
      validatePassword(field('new-password'), field('new-confirm'));
      const wallet = importPhrase(phrase, passphrase, Number(field('account-index')));
      const password = field('new-password');
      (document.getElementById('import-phrase') as HTMLTextAreaElement).value = '';
      (document.getElementById('seed-passphrase') as HTMLInputElement).value = '';
      const version = generation;
      const json = await wallet.encrypt(password);
      if (version !== generation) return;
      saveVault(json, wallet.address);
      generation++;
      active = wallet;
      exactBalance = null;
      balance = '—';
      loadHistory();
      view = 'overview';
      notice = 'Wallet imported. Check its address and download its encrypted backup.';
      render();
      try { await refresh(); } catch { notice = 'Imported. Network unavailable; try Refresh.'; render(); }
    });
  });
  document.getElementById('vault-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const password = field('password');
      (document.getElementById('password') as HTMLInputElement).value = '';
      const vault = localStorage.getItem(VAULT_KEY);
      const version = generation;
      if (vault) {
        validateKeystore(vault);
        const wallet = await Wallet.fromEncryptedJson(vault, password);
        if (version !== generation) return;
        active = wallet;
      } else {
        validatePassword(password, field('confirm'));
        (document.getElementById('confirm') as HTMLInputElement).value = '';
        const wallet = Wallet.createRandom();
        const encrypted = await wallet.encrypt(password);
        if (version !== generation) return;
        saveVault(encrypted, wallet.address);
        active = wallet;
      }
      loadHistory();
      notice = vault ? 'Wallet unlocked.' : 'Wallet created. Download your encrypted backup before adding test funds.';
      render();
      try { await refresh(); } catch { notice = 'Wallet ready. Balance unavailable: check your RPC connection and refresh.'; render(); }
    });
  });
  document.getElementById('import-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const file = (document.getElementById('keystore') as HTMLInputElement).files?.[0];
      if (!file || file.size > 100_000) throw new Error('Choose a keystore JSON file smaller than 100 KB.');
      validatePassword(field('backup-local-password'), field('backup-local-confirm'));
      const localPassword = field('backup-local-password');
      const password = field('import-password');
      (document.getElementById('backup-local-password') as HTMLInputElement).value = '';
      (document.getElementById('backup-local-confirm') as HTMLInputElement).value = '';
      (document.getElementById('import-password') as HTMLInputElement).value = '';
      const version = generation;
      const json = await file.text();
      // Re-encrypt instead of persisting arbitrary uploaded file contents.
      const { wallet, encrypted } = await restoreBackup(json, password, localPassword, localPassword);
      if (version !== generation) return;
      saveVault(encrypted, wallet.address);
      active = wallet;
      exactBalance = null;
      balance = '—';
      view = 'overview';
      generation++;
      loadHistory();
      notice = 'Wallet restored. Phrase-backed backups also restore Bitcoin Testnet and Solana Devnet accounts.';
      render();
      try { await refresh(); } catch { notice = 'Restored. Balance unavailable; try Refresh.'; render(); }
    });
  });
  document.getElementById('backup')?.addEventListener('click', downloadWalletBackup);
  document.getElementById('copy')?.addEventListener('click', () => { void task(async () => {
    await navigator.clipboard.writeText(active!.address);
    document.getElementById('notice')!.textContent = 'Public address copied.';
  }); });
  document.getElementById('refresh')?.addEventListener('click', () => void task(refresh));
  document.getElementById('send-focus')?.addEventListener('click', () => { navigate('transfer'); document.getElementById('recipient')?.focus(); });
  document.getElementById('receive-focus')?.addEventListener('click', () => { navigate('transfer'); document.getElementById('receive-card')?.scrollIntoView({ behavior: 'smooth' }); });
  if (active && document.getElementById('qr')) void QRCode.toCanvas(document.getElementById('qr'), `ethereum:${active.address}@${CHAIN_ID}`, { width: 160, margin: 1, color: { dark: '#183d35', light: '#ffffff' } }).catch(() => { document.getElementById('notice')!.textContent = 'QR unavailable. Use the address shown below.'; });
  document.getElementById('eth-contact')?.addEventListener('change', () => { const input = document.getElementById('recipient') as HTMLInputElement; input.value = field('eth-contact'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  document.getElementById('send-form')?.addEventListener('input', () => { sendRevision++; pending = null; document.getElementById('review')!.replaceChildren(); });
  document.getElementById('send-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      pending = null;
      notice = ''; document.getElementById('notice')!.textContent = '';
      document.getElementById('review')!.replaceChildren();
      const wallet = active;
      if (!wallet) throw new Error('Unlock your wallet first.');
      const version = generation;
      const revision = sendRevision;
      const { to, value } = transferInput(field('recipient'), field('amount'));
      const savedRecipient = contactNotice(to, loadContacts(wallet.address));
      const recipientWarning = savedRecipient || recipientNotice(to, wallet.address, history.filter(t => t.status === 'confirmed' && t.from.toLowerCase() === wallet.address.toLowerCase() && t.to).map(t => t.to));
      requireSepolia((await provider.getNetwork()).chainId);
      const signer = wallet.connect(provider);
      const gasLimit = await signer.estimateGas({ to, value });
      const fees = await provider.getFeeData();
      if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Network fee unavailable. Try again.');
      affordable(value, gasLimit, fees.maxFeePerGas, await provider.getBalance(wallet.address));
      if (version !== generation || revision !== sendRevision || !active) return;
      pending = { to, value, gasLimit, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, chainId: CHAIN_ID, type: 2 };
      pendingReviewedAt = Date.now();
      document.getElementById('review')!.innerHTML = `<div class="review"><strong>Review your Sepolia transfer</strong><p>To: <code>${to}</code></p><p>Amount: ${formatEther(value)} ETH</p><p>Maximum fee: ${formatEther(gasLimit * fees.maxFeePerGas)} ETH</p><p class="recipient-warning">${escape(recipientWarning)}</p><p class="hint">Network: Ethereum Sepolia. Review expires in 2 minutes.</p><label class="check"><input id="verify-eth-recipient" type="checkbox"> I verified the full recipient address and network.</label><button id="confirm-send" class="primary">Confirm & send test ETH</button><button id="cancel-send" class="quiet">Cancel</button></div>`;
      document.getElementById('cancel-send')!.onclick = () => { pending = null; document.getElementById('review')!.replaceChildren(); };
      document.getElementById('confirm-send')!.onclick = () => void task(async () => {
        if (!active || !pending) throw new Error('Review the transfer again.');
        assertFreshReview(pendingReviewedAt);
        if (!(document.getElementById('verify-eth-recipient') as HTMLInputElement)?.checked) throw new Error('Confirm that you verified the full recipient address.');
        const transaction = pending;
        const version = generation;
        const signer = active.connect(provider);
        requireSepolia((await provider.getNetwork()).chainId);
        if (version !== generation || !active) throw new Error('Wallet locked. Review the transfer again.');
        // Consume the review once. A provider timeout can be ambiguous; do not retry automatically.
        pending = null;
        document.getElementById('review')!.replaceChildren();
        const populated = await signer.populateTransaction(transaction);
        const signed = await signer.signTransaction(populated);
        assertSignedMatchesReview(signed, transaction, signer.address);
        assertFreshReview(pendingReviewedAt);
        if (version !== generation || !active) throw new Error('Wallet locked or view changed. Transfer was not broadcast.');
        const entry: TokenSubmission = { hash: keccak256(signed), contract: ZeroAddress, to: String(transaction.to), amount: String(transaction.value), symbol: 'ETH', decimals: 18, nonce: populated.nonce ?? undefined, timestamp: new Date().toISOString(), status: 'unknown' };
        const sent = await submitTracked(signed, entry, row => {
          const rows = nativeSubmissions(signer.address);
          localStorage.setItem(nativeJournalKey(signer.address), JSON.stringify([row, ...rows.filter(r => r.hash !== row.hash)].slice(0, 200)));
          if (version === generation) { const list = document.getElementById('eth-submissions'); if (list) list.innerHTML = nativeSubmissionRows(); }
        }, raw => provider.broadcastTransaction(raw), () => version === generation && !!active && revision === sendRevision);
        if (version !== generation) return;
        history = mergeActivity(history, [{ id: sent.hash, hash: sent.hash, from: active!.address, to: String(transaction.to), value: String(transaction.value), timestamp: new Date().toISOString(), status: 'pending', kind: 'transaction' }]);
        persistHistory();
        notice = 'Transfer submitted. Check the explorer for confirmation before sending again.';
        render();
      });
    });
  });
}
try { if (preserveImportedWallet(localStorage, WALLET_LIST)) notice = 'An older wallet was preserved in Saved wallets. Use the normal wallet switch and unlock flow.'; } catch { notice = 'An older wallet could not be added to Saved wallets. Its original encrypted storage is preserved.'; }
render();

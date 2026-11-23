import {feeGuidance} from './wallet-guidance';
import {networkLogo,networkIconPath} from './network-identity';
import { environmentNetwork, networkLabel } from './network-environment';
import { mountRecoveryWords, mountSeedBackup } from './recovery-words';
import { phraseRestoreMarkup, createAnotherWalletMarkup } from './wallet-access';
import { isMainnetNetwork } from './network-context';
import { assetLogo } from './asset-display';
import { installHoldingsControls } from './holdings-controls';
import { createRpcProvider } from './rpc-transport';
import { enhanceCards, mountEntryTabs } from './ui-panels';
import { scrubSecretInputs } from './secret-inputs';
import { networkAsset, networkHeading, usesNativeWorkspace, supportsPage, savedNetwork, networkIds, isNetworkId, type NetworkId } from './network-context';
import { isAdditionalEvm } from './evm-networks';
import { mountNetworkManager } from './network-manager';
import { preferredNetworks } from './network-preferences';
import { mountDemoCards } from './demo-cards-ui';
import { installSelectPickers } from './select-picker';
import { preserveImportedWallet, savedWalletLabel, saveWalletCopy } from './wallet-migration';
import { ledgerMarkup, mountLedger } from './ledger';
import { walletErrorMessage } from './error-message';
import { filterLoadedActivity } from './activity-filter';
import { backupStage, recordBackup, backupGuidance } from './backup-status';
import { inspectSubmissions, submissionDetail, submitTracked } from './transaction-reliability';
import { nativeJournalKey, parseJournal, type TokenSubmission } from './token-journal';
import { feePresets, formatGwei, replacementTotal, type FeePreset } from './fees';
import { simulationFailure } from './simulation';
import { assertNonceFree, earlierPendingCount } from './nonce-safety';
import { withSepoliaSendLock, assertSepoliaNonceFree, strictSepoliaJournal, retainSepoliaSubmission } from './sepolia-send';
import { planReplacement, replacementBlockedReason, type ReplacementIntent, type ReplacementPlan } from './replacements';
import { watchMarkup, mountWatch, watchReadApi } from './watch-only';
import { contactsMarkup, mountContacts, contactOptions, loadContacts, contactNotice, contactsKey } from './contacts';
import { verifyBackup, changePassword, commitGroupPassword } from './recovery';
import { accountLabel, accountVaultKey, ACCOUNTS_KEY, adoptActiveVault, deriveHdAccount, findAccount, groupForAddress, loadAccountRegistry, nextHdIndex, nicknameInput, privateKeyInput, registerNewAccount, renameAccount, type AccountGroup, type WalletAccount } from './accounts';
import { tokensMarkup, mountTokens, mountTokenSummary } from './tokens';
import { mountPortfolioValue } from './portfolio-value';
import { assertFreshReview, assertSignedMatchesReview, recipientNotice } from './transfer-safety';
import { marketMarkup, mountMarket } from './market';
import { Wallet, HDNodeWallet, formatEther, getAddress, keccak256, ZeroAddress, type TransactionRequest } from 'ethers';
import QRCode from 'qrcode';
import { VAULT_KEY, CHAIN_ID, validatePassword, transferInput, requireSepolia, affordable, importPhrase } from './wallet';
import { fetchActivity, historyKey, mergeActivity, type Activity } from './activity';
import './style.css';
import { cachedActivity, validateKeystore, restoreBackup } from './security';

type LocalWallet = Wallet | HDNodeWallet;
const root = document.querySelector<HTMLDivElement>('#app')!;
const rpc = import.meta.env.VITE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const provider = createRpcProvider(rpc);
let active: LocalWallet | null = null;
let accountSession = new Map<string, LocalWallet>();
let pending: TransactionRequest | null = null;
let pendingReviewedAt = 0;
let replacementPlan: ReplacementPlan | null = null;
let replacementReviewedAt = 0;
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
let disposeEvm: (() => void) | undefined;
let disposeNetworks: (() => void) | undefined;
let disposeCards: (() => void) | undefined;
let disposeTron: (() => void) | undefined;
let disposeSolanaMainnet: (() => void) | undefined;
let pendingSeed: {address:string;phrase:string}|undefined;
let disposeSeed: (()=>void)|undefined;
let disposeTrade:(()=>void)|undefined;
let disposeCrossOverview:(()=>void)|undefined;
let disposeBitcoinMainnet: (() => void) | undefined;
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
  document.getElementById('overview-assets')?.parentElement?.dispatchEvent(new Event('portfolio-privacy-change'));
  const totals = portfolioTotals();
  for (const [id, text] of [['portfolio-balance', exactBalance == null ? '—' : formatEther(exactBalance)], ['portfolio-received', formatEther(totals.received)], ['portfolio-sent', formatEther(totals.sent)]]) {
    const el = document.getElementById(id);
    if (el) el.textContent = amountsHidden ? '••••••' : text;
  }
  const portfolioToggle = document.getElementById('portfolio-privacy');
  if (portfolioToggle) { portfolioToggle.textContent = amountsHidden ? 'Show holdings' : 'Hide holdings'; portfolioToggle.setAttribute('aria-pressed', String(amountsHidden)); }
}
const pages: Record<string, { title: string; subtitle: string; icon: string }> = {
  networks: { title: 'Choose your network.', subtitle: 'Search supported networks, save favorites and manage your network list.', icon: '⊞' },
  swap: {title:'Swap tokens',subtitle:'Swap Ethereum USDT and USDC with local signing and a separate review for every step.',icon:'&#8644;'},
  buy: {title:'Buy USDT',subtitle:'Purchase with a card through an external provider.',icon:'+'},
  cards: { title: 'Explore virtual cards.', subtitle: 'Demo controls and synthetic purchases. No real payments or issued cards.', icon: '▱' },
  tokens: { title: 'Tokens', subtitle: 'Track and transfer ERC-20 tokens on Ethereum Sepolia.', icon: 'T' },
  portfolio: { title: 'Portfolio', subtitle: 'Holdings and activity for your current wallet.', icon: '◈' },
  overview: { title: 'Overview', subtitle: 'A simple home for your digital assets.', icon: '▦' },
  market: { title: 'Market', subtitle: 'Live ETH/USDT prices and historical candles.', icon: '$' },
  transfer: { title: 'Send & receive.', subtitle: 'Move test ETH on Ethereum Sepolia.', icon: '↗' },
  activity: { title: 'Activity', subtitle: 'Your incoming and outgoing Sepolia activity.', icon: '◷' },
  ledger: { title: 'Sign on your device.', subtitle: 'Ledger hardware signing for Sepolia ETH.', icon: 'L' },
  watch: { title: 'Follow an address.', subtitle: 'Read-only tracking. No keys required.', icon: 'W' },
  contacts: { title: 'Know your recipient.', subtitle: 'Addresses you have personally confirmed.', icon: '@' },
  settings: { title: 'Security & wallets', subtitle: 'Manage recovery, backups and saved wallets.', icon: '⌑' },
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
  if (sidebar) sidebar.inert = !!pendingSeed || (window.matchMedia('(max-width: 650px)').matches && !mobileMenuOpen);
}
window.addEventListener('resize', updateSidebar);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileMenuOpen) { mobileMenuOpen = false; updateSidebar(); document.getElementById('mobile-menu-toggle')?.focus(); }
});

function vaults(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(WALLET_LIST) || '{}'); } catch { return {}; }
}
function saveVault(json: string, address: string) {
  saveWalletCopy(localStorage,WALLET_LIST,VAULT_KEY,json,address);
}
function loadHistory() {
  try { history = cachedActivity(JSON.parse(localStorage.getItem(historyKey(active!.address)) || '[]')); } catch { history = []; }
  cursors = [null, null];
}
function persistHistory() { if (active) localStorage.setItem(historyKey(active.address), JSON.stringify(history)); }
function clearSecrets() { pendingSeed=undefined;disposeSeed?.();disposeSeed=undefined;clearTimeout(revealTimer); document.getElementById('phrase-display')?.replaceChildren(); document.getElementById('key-display')?.replaceChildren(); }
function navigate(next: string) { if (next === 'multi') next = 'overview'; generation++; clearSecrets(); pending = null; replacementPlan = null; view = next; render(); }
async function withActiveSepoliaLock(work: () => Promise<void>) {
  const wallet = active, version = generation;
  if (!wallet) throw new Error('Unlock your wallet first.');
  return withSepoliaSendLock(wallet.address, async () => {
    if (active !== wallet || generation !== version) throw new Error('Wallet or view changed before the send lock was acquired. Review again.');
    await work();
  });
}
function selectNetwork(choice: NetworkId, next: string) {
  selectedNetwork = choice;
  localStorage.setItem('forma.network.v1', choice);
  navigate(next);
  if (choice !== 'eth' || !active) return;
  const version = generation;
  // Public reads may finish after a network switch; never repaint a newer view.
  void refresh().then(() => {
    if (generation === version && active && selectedNetwork === 'eth') render();
  }).catch(() => {
    if (generation !== version || !active || selectedNetwork !== 'eth') return;
    notice = 'Ethereum balance unavailable. Check your connection and refresh.';
    render();
  });
}

function nativeSubmissions(address: string) {
  try { return parseJournal(JSON.parse(localStorage.getItem(nativeJournalKey(address)) || '[]')); } catch { return []; }
}
function nativeSubmissionRows() {
  if (!active) return '';
  const rows = nativeSubmissions(active.address);
  return rows.map(row => {
    const intent = row.intent ?? 'transfer';
    const title = intent === 'cancel' ? 'Cancel pending transfer' : intent === 'speed-up' ? 'Speed-up replacement' : 'Sent ETH';
    const amount = intent === 'cancel' ? '0 ETH' : `${formatEther(row.amount)} ETH`;
    const links = [
      row.replaces ? `<p class="hint">Replaces <a href="https://sepolia.etherscan.io/tx/${row.replaces}" target="_blank" rel="noopener noreferrer">${short(row.replaces)}</a></p>` : '',
      row.replacedBy ? `<p class="hint">Replaced by <a href="https://sepolia.etherscan.io/tx/${row.replacedBy}" target="_blank" rel="noopener noreferrer">${short(row.replacedBy)}</a></p>` : '',
    ].join('');
    const actions = replacementBlockedReason(row) ? '' : `<div class="submission-actions"><button type="button" class="quiet" data-speedup="${row.hash}">Speed up</button><button type="button" class="quiet" data-cancel-tx="${row.hash}">Cancel transfer</button></div>`;
    return `<div class="history-row">${assetLogo('ETH', true)}<div class="history-identity"><strong>${title}</strong><p>${escape(submissionDetail(row))}</p><p class="hint">Nonce ${row.nonce ?? '—'} · ${escape(new Date(row.timestamp).toLocaleString())}</p><code>To: ${row.to}</code>${links}<a href="https://sepolia.etherscan.io/tx/${row.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${amountsHidden ? '••••••' : escape(amount)}</strong><span class="status-chip status-${row.status}">${row.status}</span>${actions}</div></div>`;
  }).join('') || '<div class="empty"><h3>No matching submissions</h3><p>Your transfers from this browser will appear here.</p></div>';
}
function openReplacement(hash: string, intent: ReplacementIntent) {
  if (!active || busy) return;
  const row = nativeSubmissions(active.address).find(candidate => candidate.hash.toLowerCase() === hash.toLowerCase());
  if (!row) { notice = 'The original transfer is no longer in this browser’s journal.'; return; }
  let plan: ReplacementPlan;
  try { plan = planReplacement(row, active.address, intent); }
  catch (error) { notice = error instanceof Error ? error.message : 'This transfer cannot be replaced.'; const el = document.getElementById('notice'); if (el) el.textContent = notice; return; }
  replacementPlan = plan;
  replacementReviewedAt = Date.now();
  renderReplacementReview();
  document.getElementById('replacement-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function renderReplacementReview() {
  const host = document.getElementById('replacement-review');
  if (!host) return;
  const plan = replacementPlan;
  if (!plan) { host.replaceChildren(); return; }
  const gasLimit = BigInt(plan.tx.gasLimit!);
  const total = replacementTotal(gasLimit, plan.quote);
  const cancel = plan.intent === 'cancel';
  host.innerHTML = `<form id="replacement-form" class="review replacement-review"><strong>${cancel ? 'Cancel pending transfer' : 'Speed up pending transfer'}</strong><p>Original transaction: <a href="https://sepolia.etherscan.io/tx/${plan.row.hash}" target="_blank" rel="noopener noreferrer">${short(plan.row.hash)}</a></p><p>Nonce: <strong>${plan.row.nonce}</strong>${cancel ? ` · sends 0 ETH to your own account (${short(active!.address)})` : ` · same recipient and ${formatEther(plan.row.amount)} ETH`}</p><p>New priority tip: ${formatGwei(plan.quote.maxPriorityFeePerGas)} gwei<br>New maximum fee per gas: ${formatGwei(plan.quote.maxFeePerGas)} gwei<br>Worst-case network fee: ${formatEther(total)} ETH</p><p class="hint">Both fee fields are raised by at least 12.5%. This is Forma policy, not a copied MetaMask threshold. Only one transaction can be mined for this nonce; the miner may choose the original instead.</p>${cancel ? '<p class="hint">Cancelling moves no ETH, but the replacement transaction still costs gas.</p>' : ''}<label class="check"><input id="verify-replacement" type="checkbox"> I understand this replacement competes with the original transaction.</label><button class="primary" type="submit">${cancel ? 'Confirm cancellation' : 'Confirm speed-up'}</button><button class="quiet" type="button" id="replacement-cancel">Keep original</button></form>`;
  document.getElementById('replacement-cancel')!.onclick = () => { replacementPlan = null; replacementReviewedAt = 0; host.replaceChildren(); };
  const form = document.getElementById('replacement-form') as HTMLFormElement;
  form.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => withActiveSepoliaLock(async () => {
      if (!active || !replacementPlan) throw new Error('Choose a transfer to replace again.');
      const currentPlan = replacementPlan;
      assertFreshReview(replacementReviewedAt);
      if (!(document.getElementById('verify-replacement') as HTMLInputElement)?.checked) throw new Error('Confirm that you understand the replacement competes with the original transfer.');
      const version = generation;
      requireSepolia((await provider.getNetwork()).chainId);
      if (version !== generation || !active) throw new Error('Wallet locked or view changed. Nothing was signed.');
      const signer = active.connect(provider);
      const owner = signer.address;
      const latestNonce = await provider.getTransactionCount(owner, 'latest');
      if (version !== generation || !active) throw new Error('Wallet locked or view changed. Nothing was signed.');
      const nonce = currentPlan.row.nonce;
      if (nonce === undefined) throw new Error('The original nonce was not recorded, so this transfer cannot be replaced.');
      if (latestNonce > nonce) throw new Error(`Nonce ${nonce} is already mined. This transfer can no longer be replaced.`);
      const rows = nativeSubmissions(owner);
      const fresh = rows.find(row => row.hash.toLowerCase() === currentPlan.row.hash.toLowerCase());
      if (!fresh) throw new Error('The original transfer is no longer in this browser’s journal.');
      const blocked = replacementBlockedReason(fresh);
      if (blocked) throw new Error(blocked);
      assertSepoliaNonceFree(owner, nonce, { excludeHash: fresh.hash });
      affordable(BigInt(currentPlan.tx.value ?? 0n), BigInt(currentPlan.tx.gasLimit!), currentPlan.quote.maxFeePerGas, await provider.getBalance(owner));
      if (version !== generation || !active) throw new Error('Wallet locked or view changed. Nothing was signed.');
      const populated = await signer.populateTransaction(currentPlan.tx);
      if (version !== generation || !active) throw new Error('Wallet locked or view changed. Nothing was signed.');
      if (populated.nonce !== nonce) throw new Error('The nonce changed before signing. Review the replacement again.');
      assertFreshReview(replacementReviewedAt);
      const signed = await signer.signTransaction(populated);
      assertSignedMatchesReview(signed, { ...currentPlan.tx, nonce }, owner);
      assertFreshReview(replacementReviewedAt);
      if (version !== generation || !active) throw new Error('Wallet locked or view changed. Nothing was broadcast.');
      const hash = keccak256(signed);
      const entry: TokenSubmission = { hash, contract: ZeroAddress, to: String(currentPlan.tx.to), amount: String(currentPlan.tx.value ?? 0n), decimals: 18, symbol: 'ETH', nonce, timestamp: new Date().toISOString(), status: 'unknown', gasLimit: BigInt(currentPlan.tx.gasLimit!).toString(), maxFeePerGas: currentPlan.quote.maxFeePerGas.toString(), maxPriorityFeePerGas: currentPlan.quote.maxPriorityFeePerGas.toString(), intent: currentPlan.intent, replaces: currentPlan.row.hash };
      const sent = await submitTracked(signed, entry, row => {
        const existing = strictSepoliaJournal(localStorage, nativeJournalKey(owner));
        localStorage.setItem(nativeJournalKey(owner), JSON.stringify(retainSepoliaSubmission(existing, row)));
        if (version === generation) { const list = document.getElementById('eth-submissions'); if (list) list.innerHTML = nativeSubmissionRows(); }
      }, raw => provider.broadcastTransaction(raw), () => version === generation && !!active);
      let linked = true;
      try {
        const existing = nativeSubmissions(owner);
        localStorage.setItem(nativeJournalKey(owner), JSON.stringify(existing.map(row => row.hash.toLowerCase() === currentPlan.row.hash.toLowerCase() ? { ...row, replacedBy: sent.hash } : row)));
      } catch { linked = false; }
      if (version !== generation) return;
      replacementPlan = null;
      replacementReviewedAt = 0;
      notice = `${currentPlan.intent === 'cancel' ? 'Cancellation' : 'Speed-up'} submitted with nonce ${currentPlan.row.nonce}. ${linked ? 'The original record is linked to the replacement.' : 'The new record was saved, but the original record could not be linked.'} Check the explorer before sending again.`;
      render();
      const updated = generation;
      void refresh().catch(() => { if (updated !== generation) return; notice = 'Replacement submitted. Balance unavailable; try Refresh.'; render(); });
    }), form);
  });
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

function isHdWallet(wallet: LocalWallet | null | undefined): wallet is HDNodeWallet {
  return !!wallet && wallet instanceof HDNodeWallet && !!wallet.mnemonic;
}
function currentGroup(): AccountGroup | undefined {
  return active ? groupForAddress(localStorage, active.address) : undefined;
}
function currentAccount(): WalletAccount | undefined {
  return active ? findAccount(loadAccountRegistry(localStorage), active.address) : undefined;
}
function accountOptionLabel(account: WalletAccount) {
  return `${accountLabel(account)} · ${short(account.address)}${account.kind === 'imported' ? ' · imported' : ''}`;
}
function accountOptions() {
  const group = currentGroup();
  const accounts: WalletAccount[] = group?.accounts ?? (active ? [{ address: active.address, kind: isHdWallet(active) ? 'hd' : 'imported', addedAt: new Date().toISOString() }] : []);
  return accounts.map(account => `<option value="${account.address}" ${active && account.address.toLowerCase() === active.address.toLowerCase() ? 'selected' : ''}>${escape(accountOptionLabel(account))}</option>`).join('');
}
async function hydrateAccounts(password: string, wallet: LocalWallet, vaultJson: string) {
  const version=generation,session=new Map([[wallet.address.toLowerCase(), wallet]]);
  accountSession = session;
  let group: AccountGroup;
  try { group = adoptActiveVault(localStorage, vaultJson); } catch { return; }
  await Promise.all(group.accounts.map(async account => {
    const key = account.address.toLowerCase();
    if (session.has(key)) return;
    const json = localStorage.getItem(accountVaultKey(account.address));
    if (!json) return;
    try {
      const accountWallet = await Wallet.fromEncryptedJson(json, password);
      if (generation===version && active===wallet && accountSession===session && accountWallet.address.toLowerCase() === key) session.set(key, accountWallet);
    } catch { /* A legacy copy with a different password unlocks individually. */ }
  }));
}
function switchAccount(address: string) {
  if (!active || busy) return;
  const target = getAddress(address);
  if (target.toLowerCase() === active.address.toLowerCase()) return;
  const key = target.toLowerCase();
  const wallet = accountSession.get(key);
  const json = localStorage.getItem(accountVaultKey(target));
  const record = currentGroup()?.accounts.find(account => account.address.toLowerCase() === key);
  if (!wallet || !json) {
    if (json) {
      localStorage.setItem(VAULT_KEY, json);
      lock();
      notice = 'Selected account is locked. Enter its password to unlock it.';
      render();
    } else {
      notice = 'This account has no encrypted copy on this browser. Import it again from its backup.';
      render();
    }
    return;
  }
  clearSecrets();
  clearTimeout(idle);
  pending = null;
  pendingReviewedAt = 0;
  replacementPlan = null;
  replacementReviewedAt = 0;
  generation++;
  localStorage.setItem(VAULT_KEY, json);
  active = wallet;
  exactBalance = null;
  balance = '—';
  loadHistory();
  notice = record ? `Switched to ${accountLabel(record)}.` : 'Account switched.';
  render();
  const version = generation;
  void refresh().then(() => { if (version === generation) render(); })
    .catch(() => { if (version !== generation) return; notice = 'Account selected. Balance unavailable; try Refresh.'; render(); });
}
function downloadAccountBackup(address: string) {
  if (!active) return;
  const target = getAddress(address);
  const json = target.toLowerCase() === active.address.toLowerCase() ? localStorage.getItem(VAULT_KEY) : localStorage.getItem(accountVaultKey(target));
  if (!json) throw new Error('Encrypted backup not found for this account.');
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `forma-account-${target.slice(-6).toLowerCase()}-encrypted-backup.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  recordBackup(localStorage, target, json, 'requested');
  notice = 'Account backup download requested. It is encrypted with this wallet’s password.';
  render();
}
async function verifyWalletPassword(password: string) {
  if (!active) throw new Error('Unlock your wallet first.');
  const json = localStorage.getItem(VAULT_KEY);
  if (!json) throw new Error('Wallet vault is unavailable.');
  let wallet: LocalWallet;
  try { wallet = await Wallet.fromEncryptedJson(json, password); } catch { throw new Error('Incorrect wallet password.'); }
  if (wallet.address.toLowerCase() !== active.address.toLowerCase()) throw new Error('Incorrect wallet password.');
  return wallet;
}
function accountsMarkup() {
  const group = currentGroup();
  const accounts = group?.accounts ?? [];
  const record = currentAccount();
  const canDerive = isHdWallet(active);
  let suggested = '';
  try { suggested = String(nextHdIndex(group)); } catch { suggested = ''; }
  const rows = accounts.map(account => {
    const current = !!active && account.address.toLowerCase() === active.address.toLowerCase();
    return `<div class="account-row${current ? ' is-current' : ''}"><span class="account-avatar" aria-hidden="true">${account.kind === 'hd' ? '◇' : '⌘'}</span><div class="account-identity"><strong>${escape(accountLabel(account))}${current ? ' <span class="pill">Current</span>' : ''}</strong><code>${account.address}</code><p class="hint">${account.kind === 'hd' ? `Phrase-backed${typeof account.index === 'number' ? ` · index ${account.index}` : ''}` : 'Imported private key · not covered by the recovery phrase'}</p></div><div class="account-actions">${current ? '' : `<button type="button" class="text-button" data-switch-account="${account.address}">Switch</button>`}<button type="button" class="text-button" data-backup-account="${account.address}">Back up</button><button type="button" class="text-button" data-rename-account="${account.address}">Rename</button></div></div>`;
  }).join('') || '<p class="hint">Unlock the wallet to load its accounts.</p>';
  return `<h3>Accounts</h3><p>Phrase-backed accounts share this wallet’s password and can be re-derived from the recovery phrase. Imported private keys are separate: the recovery phrase does not restore them, so download each imported account’s encrypted backup.</p><div class="account-list">${rows}</div>
  ${canDerive && suggested !== '' ? `<details class="account-form-disclosure"><summary>Add a phrase-backed account</summary><form id="add-account-form"><label for="add-account-index">Derivation index (next unused: ${suggested})</label><input id="add-account-index" type="number" min="0" max="100" value="${suggested}" required><label for="add-account-password">Wallet password</label><input id="add-account-password" type="password" autocomplete="current-password" required><button class="quiet">Add account</button></form></details>` : '<p class="hint">This account was imported without a usable recovery phrase, so new accounts cannot be derived here. Import a private key instead.</p>'}
  <details class="account-form-disclosure"><summary>Import a private key</summary><form id="import-key-form"><label for="import-key">Private key (64 hexadecimal characters)</label><input id="import-key" type="password" autocomplete="off" spellcheck="false" required><label for="import-key-nickname">Nickname (optional)</label><input id="import-key-nickname" maxlength="40" autocomplete="off"><label for="import-key-password">Wallet password</label><input id="import-key-password" type="password" autocomplete="current-password" required><label class="check"><input id="import-key-ack" type="checkbox" required> I understand this key is not restored by the recovery phrase and needs its own encrypted backup.</label><button class="quiet">Import private key</button></form></details>
  <details class="account-form-disclosure"><summary>Rename an account</summary><form id="rename-account-form"><label for="rename-account-address">Account</label><select id="rename-account-address" required>${accounts.map(account => `<option value="${account.address}" ${account.address === record?.address ? 'selected' : ''}>${escape(accountLabel(account))}</option>`).join('')}</select><label for="rename-account-nickname">Nickname (leave empty to clear)</label><input id="rename-account-nickname" maxlength="40" autocomplete="off"><button class="quiet">Save nickname</button></form></details>
  <h3>Reveal the active private key</h3><p>Re-enter the wallet password to show the key for 30 seconds. Anyone who sees it can control this account.</p><form id="reveal-key-form"><label for="reveal-key-password">Wallet password</label><input id="reveal-key-password" type="password" autocomplete="current-password" required><button class="quiet">Reveal private key for 30 seconds</button></form><div id="key-display" aria-live="off"></div>`;
}

function lock() {
  scrubSecretInputs(root);
  exactBalance = null;
  mobileMenuOpen = false;
  clearSecrets();
  generation++;
  active = null;
  accountSession.clear();
  pending = null;
  replacementPlan = null;
  replacementReviewedAt = 0;
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
  <section class="card portfolio-assets"><div class="section-heading"><h2>Assets</h2><span class="pill">Ethereum Sepolia</span></div><div class="asset-row">${assetLogo('ETH', true)}<div><strong>Ethereum</strong><p>Sepolia ETH</p></div><div class="asset-network"><strong>Testnet</strong><p>No monetary value</p></div><button id="portfolio-send" class="quiet">Send ETH</button></div><p class="hint">Your current native ETH balance appears above. USD figures below are hypothetical reference values, not redeemable funds or investment returns.</p></section>
  <section class="card portfolio-assets" id="token-assets-summary"></section><button class="quiet" id="portfolio-tokens">Manage ERC-20 tokens</button><section class="card portfolio-performance"><div class="eyebrow">HYPOTHETICAL UNREALIZED GAIN / LOSS</div><h2 id="portfolio-pnl">Loading deposit prices...</h2><p id="portfolio-since">Finding earliest loaded deposit...</p><p id="portfolio-basis"></p><p class="hint">Weighted-average deposit-minute USD price; withdrawals reduce the remaining basis proportionally. Gas, realized returns and external acquisition costs are excluded. Estimates use loaded history and may be incomplete.</p><p id="portfolio-price-source" class="hint"></p></section><section class="card portfolio-deposits"><h2>Deposit valuation history</h2><p class="hint">Latest 25 loaded deposits. Each compares the deposit-minute ETH/USD open with today's quote for that original amount, even if some ETH was later sent.</p><div id="portfolio-deposit-history"></div></section><div class="portfolio-grid portfolio-flow"><section class="card"><div class="eyebrow">RECEIVED · LOADED HISTORY</div><h2><span id="portfolio-received">—</span> ETH</h2><p>Confirmed incoming transfers, excluding self-transfers.</p></section><section class="card"><div class="eyebrow">SENT · LOADED HISTORY</div><h2><span id="portfolio-sent">—</span> ETH</h2><p>Confirmed outgoing transfers, excluding network fees and self-transfers.</p></section></div><p class="hint">Flow totals use ${history.length} locally loaded records, including internal transfers. They are not lifetime totals or a profit/loss calculation. Load older records under Activity to extend coverage.</p><button id="portfolio-activity" class="quiet">View transaction history</button></section>`;
}
function touch() {
  clearTimeout(idle);
  if (active) idle = setTimeout(lock, 5 * 60 * 1000);
}
document.addEventListener('pointerdown', touch);
document.addEventListener('keydown', touch);
document.addEventListener('click', event => {
  const target = event.target;
  const button = target instanceof Element ? target.closest<HTMLElement>('[data-speedup],[data-cancel-tx]') : null;
  if (!button || !active) return;
  const speedUp = button.hasAttribute('data-speedup');
  const hash = button.getAttribute(speedUp ? 'data-speedup' : 'data-cancel-tx');
  if (hash) openReplacement(hash, speedUp ? 'speed-up' : 'cancel');
});
document.addEventListener('visibilitychange', () => { if(document.hidden) {scrubSecretInputs(root);clearSecrets();if(active || busy) lock();} });
window.addEventListener('pagehide', () => { scrubSecretInputs(root);clearSecrets();if (active || busy) lock(); });
window.addEventListener('pageshow', event=>{if(event.persisted) {scrubSecretInputs(root);clearSecrets();if(active || busy) lock();}});
window.addEventListener('storage', event => { if ((event.key === VAULT_KEY || event.key === ACCOUNTS_KEY || (active && event.key === contactsKey(active.address)) || event.key === null) && (active || busy)) lock(); });

function render() {
  disposeCrossOverview?.();disposeCrossOverview=undefined;disposeTrade?.();disposeTrade=undefined;
  disposeSeed?.();disposeSeed=undefined;
  replacementPlan = null; replacementReviewedAt = 0;
  disposeMarket?.(); disposeMarket = undefined;
  disposePortfolio?.(); disposePortfolio = undefined;
  disposeTokens?.(); disposeTokens = undefined;
  disposeLedger?.(); disposeLedger = undefined;
  disposeMulti?.(); disposeMulti = undefined;
  disposeEvm?.(); disposeEvm = undefined;
  disposeNetworks?.(); disposeNetworks = undefined;
  disposeCards?.(); disposeCards = undefined;
  disposeTron?.(); disposeTron = undefined;
  disposeSolanaMainnet?.(); disposeSolanaMainnet = undefined;
  disposeBitcoinMainnet?.(); disposeBitcoinMainnet = undefined;
  disposeWatch?.(); disposeWatch = undefined;
  disposeTokenSummary?.(); disposeTokenSummary = undefined;
  root.dataset.page=view; root.dataset.network=selectedNetwork;
  root.classList.toggle('wallet-locked', !active);
  root.classList.toggle('is-entry', !active && view === 'overview');
  root.classList.toggle('is-ledger', view === 'ledger');
  const hasVault = !!localStorage.getItem(VAULT_KEY);
  const page = pages[view] || pages.overview;
  const native = !!active && usesNativeWorkspace(selectedNetwork, view);
  const additionalEvm = !!active && isAdditionalEvm(selectedNetwork) && ['overview', 'portfolio', 'transfer', 'tokens', 'activity'].includes(view);
  const tron = !!active && (selectedNetwork === 'tron' || selectedNetwork === 'tron-mainnet') && ['overview', 'portfolio', 'transfer', 'tokens', 'activity'].includes(view);
  const bitcoinMainnet = !!active && selectedNetwork === 'btc-mainnet' && ['overview','portfolio','transfer','activity'].includes(view);
  const solanaMainnet = !!active && selectedNetwork === 'sol-mainnet' && ['overview','portfolio','transfer','tokens','activity'].includes(view);
  const available = supportsPage(selectedNetwork, view);
  const asset = networkAsset(selectedNetwork);
  const title = active && view==='overview'?'Your portfolio':active && ['overview','portfolio','transfer','activity','market','tokens','contacts','watch'].includes(view) ? networkHeading(selectedNetwork, view) : page.title;
  const subtitle = active&&view==='overview'?'Assets across supported networks for your current account.':(view==='swap'||view==='buy')?page.subtitle:view === 'market' ? `Live ${asset.symbol}/USDT prices and historical candles.` : selectedNetwork !== 'eth' ? `${networkLabel(selectedNetwork)} · Assets and activity for your selected account.` : page.subtitle;
  const content = active && view === 'networks' ? '<section id="network-manager-panel"></section>'
    : active && view === 'overview' ? '<section id="cross-network-overview"></section>'
    : active && (view==='swap'||view==='buy') ? '<section id="trade-panel"></section>'
    : active && view === 'cards' ? '<section id="demo-cards-panel"></section>'
    : !available ? `<section class="card"><h2>${asset.name}: feature unavailable</h2><p>This feature is not enabled on the selected network. Choose an available feature from the navigation or switch networks.</p></section>`
    : active && view === 'market' ? marketMarkup(selectedNetwork)
    : solanaMainnet ? `${networkAccountsMarkup()}<section id="solana-mainnet-panel"><p role="status">Opening Solana Mainnet…</p></section>`
    : bitcoinMainnet ? `${networkAccountsMarkup()}<section id="bitcoin-mainnet-panel"><p role="status">Opening Bitcoin Mainnet…</p></section>`
    : tron ? `${networkAccountsMarkup()}<section id="tron-panel"><p role="status">Opening selected TRON network…</p></section>`
    : additionalEvm ? `${networkAccountsMarkup()}<section id="evm-panel"><p role="status">Opening selected network…</p></section>`
    : native ? `${view === 'overview' ? networkAccountsMarkup() : ''}<section id="multi-panel" class="multichain-workspace"><p role="status">Opening selected network…</p></section>`
    : selectedNetwork !== 'eth' && ['watch','contacts'].includes(view) ? `<section id="${view === 'watch' ? 'watch-panel' : 'contacts-panel'}" class="card">Loading network accounts…</section>`
    : view === 'ledger' ? ledgerMarkup() : view === 'watch' ? watchMarkup()
    : active ? selectedNetwork !== 'eth' ? settings() : dashboard() + portfolio() + tokensMarkup() + marketMarkup('eth') + settings() + contactsMarkup(active.address)
    : onboarding(hasVault);

  root.innerHTML = `<button id="sidebar-backdrop" aria-label="Close navigation" tabindex="-1"></button><aside id="wallet-sidebar"><a class="brand" href="/">◈ <span>forma</span></a><button id="sidebar-toggle" class="sidebar-toggle" aria-controls="wallet-sidebar" title="Toggle sidebar"></button><div class="workspace">PERSONAL WALLET</div><nav aria-label="Wallet navigation">${[['overview','Overview'],['networks','Networks'],['portfolio','Portfolio'],['tokens','Tokens'],['transfer','Send & receive'],['swap','Swap'],['buy','Buy USDT'],['market','Market'],['activity','Activity'],['ledger','Ledger'],['watch','Watch-only'],['contacts','Contacts'],['cards','Cards · demo'],['settings','Recovery & import']].map(([id,label]) => `<button data-view="${id}" title="${supportsPage(selectedNetwork, id) ? label : label + ' (not enabled on this network)'}" aria-label="${label}" ${(!active && id !== 'overview') || !supportsPage(selectedNetwork, id) ? 'disabled' : ''} class="${view === id ? 'selected' : ''}" aria-current="${view === id ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${pages[id].icon}</span><span class="nav-label">${label}</span></button>`).join('')}</nav><div class="aside-bottom"><span class="dot"></span> Your keys. Your control.<small>Self-custody, by design.</small></div></aside>
    <main><header><a href="/" class="entry-brand" aria-label="Forma home"><span aria-hidden="true">&#9672;</span> forma<span class="brand-caption">YOUR PERSONAL WALLET</span></a><button id="mobile-menu-toggle" class="quiet" aria-label="Open navigation" aria-controls="wallet-sidebar">&#9776;</button><div class="crumb">My wallet <span>/</span> ${view === 'multi' ? 'Bitcoin & Solana' : view === 'swap' ? 'Swap' : view === 'buy' ? 'Buy USDT' : view === 'cards' ? 'Cards · demo' : view === 'networks' ? 'Networks' : view === 'overview' ? 'Overview' : view === 'transfer' ? 'Send & receive' : view === 'activity' ? 'Activity' : view === 'market' ? 'Market' : view === 'portfolio' ? 'Portfolio' : view === 'tokens' ? 'Tokens' : view === 'contacts' ? 'Contacts' : view === 'watch' ? 'Watch-only' : view === 'ledger' ? 'Ledger' : 'Recovery & import'}</div><div class="header-tools"><label class="theme-control" for="theme-select"><span>Appearance</span><select id="theme-select" aria-label="Appearance">${['system','light','dark'].map(t => `<option value="${t}" ${theme === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}</select></label></div></header>
    <section class="content">${active ? walletContextMarkup()+feeGuidance(selectedNetwork) : ''}<div class="title-row"><div><div class="eyebrow">YOUR WALLET WORKSPACE</div><h1>${title}</h1><p>${subtitle}</p></div>${active ? '<button id="lock" class="quiet">⌑ Lock wallet</button>' : '<span class="pill">◈ Self-custody</span>'}</div>
    <div class="test-banner">◇ <span>${isMainnetNetwork(selectedNetwork) ? '<strong>Live assets.</strong> Verify addresses before sending. Unaudited prototype. Cards are demo-only.' : '<strong>You’re on a test network.</strong> Use test tokens only. This prototype has not been audited.'}</span></div>
    <div id="notice" role="status" aria-live="polite">${escape(notice)}</div>
    ${content}
    <footer class="wallet-footer"><div class="footer-brand"><strong>FORMA</strong><span>Your keys. Your control.</span></div><div class="footer-meta"><span id="footer-network"><i class="dot"></i>${networkLabel(selectedNetwork)}</span><span>Self-custody</span><span class="footer-version">Prototype v0.1</span></div></footer></section></main>`;
  document.getElementById('lock')?.addEventListener('click', lock);
  if(active&&view==='overview'){
    const wallet=active,version=generation,environment=isMainnetNetwork(selectedNetwork),host=document.getElementById('cross-network-overview')!;
    void import('./cross-network-ui').then(module=>{
      if(!host.isConnected||generation!==version||active!==wallet)return;
      disposeCrossOverview=module.mountCrossNetworkOverview(host,wallet,environment,{
        selected:selectedNetwork,current:()=>active===wallet&&generation===version&&view==='overview'&&isMainnetNetwork(selectedNetwork)===environment,
        hidden:()=>amountsHidden,toggleHidden:()=>{amountsHidden=!amountsHidden;localStorage.setItem('forma.amounts.hidden',String(amountsHidden));},
        choose:network=>selectNetwork(network,supportsPage(network,'tokens')?'tokens':'transfer'),
      });
    }).catch(()=>{if(host.isConnected&&generation===version)host.textContent='Portfolio could not load. Reload or select a network to inspect its assets.';});
  }
  if (active && view === 'networks') {
    disposeNetworks = mountNetworkManager(document.getElementById('network-manager-panel')!, selectedNetwork,
      network => selectNetwork(network, 'overview'),
      () => { const select = document.getElementById('network-select'); if (select) select.innerHTML = networkOptionsMarkup(); });
  }
  if(active&&(view==='swap'||view==='buy')){
    const wallet=active,version=generation,mode=view,network=selectedNetwork,host=document.getElementById('trade-panel')!;
    host.innerHTML='<section class="card"><p role="status">Preparing your wallet tools…</p></section>';
    void import('./trade-ui').then(module=>{if(!host.isConnected||active!==wallet||generation!==version||view!==mode)return;disposeTrade=module.mountTrade(host,wallet,network,mode,{current:()=>active===wallet&&generation===version&&view===mode,choose:next=>selectNetwork(next,mode)});}).catch(()=>{if(host.isConnected)host.textContent='Wallet tools could not load. Reload the page to try again.';});
  }
  if (active && view === 'cards') {
    const wallet = active, version = generation;
    disposeCards = mountDemoCards(document.getElementById('demo-cards-panel')!, wallet.address, () => active === wallet && generation === version);
  }
  bind();
  if(active&&pendingSeed?.address===active.address)disposeSeed=mountSeedBackup(root,pendingSeed.phrase,()=>{pendingSeed=undefined;notice='Recovery phrase confirmed. Keep your offline copy safe and save an encrypted backup too.';render();});
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
  document.getElementById('manage-networks')?.addEventListener('click', () => navigate('networks'));
  const groups = ['wallet-summary', 'transfer-panels', 'activity-panel', 'settings-panel', 'market-panel', 'portfolio-panel', 'tokens-panel', 'contacts-panel', 'watch-panel', 'ledger-panel', 'network-accounts', 'overview-assets'];
  const visible = view === 'overview' ? ['wallet-summary', 'activity-panel', 'network-accounts', 'overview-assets'] : view === 'transfer' ? ['transfer-panels'] : view === 'activity' ? ['activity-panel'] : view === 'market' ? ['market-panel'] : view === 'portfolio' ? ['portfolio-panel'] : view === 'tokens' ? ['tokens-panel'] : view === 'contacts' ? ['contacts-panel'] : view === 'watch' ? ['watch-panel'] : view === 'ledger' ? ['ledger-panel'] : ['settings-panel'];
  groups.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = !visible.includes(id); });
  if (selectedNetwork === 'eth' && active && view === 'portfolio') disposePortfolio = mountPortfolioValue(document.getElementById('portfolio-panel')!, history, active.address, exactBalance, () => amountsHidden);
  if (selectedNetwork === 'eth' && active && view === 'tokens') { const wallet = active; const version = generation; disposeTokens = mountTokens(document.getElementById('tokens-panel')!, provider, wallet, () => active === wallet && version === generation, () => amountsHidden); }
  if (selectedNetwork === 'eth' && active && view==='portfolio') disposeTokenSummary = mountTokenSummary(document.getElementById('token-assets-summary')!, provider, active.address, () => amountsHidden);
  document.getElementById('open-ledger')?.addEventListener('click', () => { selectedNetwork = 'eth'; notice = 'Hardware wallet mode. Your local wallet remains locked.'; navigate('ledger'); });
  if (tron && active && view!=='overview') {
    const wallet = active, version = generation, network=selectedNetwork, host = document.getElementById('tron-panel')!;
    void import('./tron-workspace').then(module => {
      if (!host.isConnected || generation !== version || active !== wallet || selectedNetwork !== network) return;
      disposeTron = module.mountTronWorkspace(host, wallet, {
        current: () => active === wallet && generation === version && selectedNetwork === network,
        mainnet: network === 'tron-mainnet',
        hidden: () => amountsHidden, page: view,
        toggleHidden: () => { amountsHidden = !amountsHidden; localStorage.setItem('forma.amounts.hidden', String(amountsHidden)); },
      });
    }).catch(() => { if (host.isConnected && generation === version) host.textContent = 'TRON workspace could not load. Try refreshing.'; });
  }
  if (bitcoinMainnet && active && view!=='overview') {
    const wallet=active,version=generation,host=document.getElementById('bitcoin-mainnet-panel')!;
    void import('./bitcoin-mainnet-ui').then(module=>{
      if(!host.isConnected||generation!==version||active!==wallet||selectedNetwork!=='btc-mainnet')return;
      disposeBitcoinMainnet=module.mountBitcoinMainnet(host,wallet,{
        current:()=>active===wallet&&generation===version&&selectedNetwork==='btc-mainnet',
        hidden:()=>amountsHidden,page:view,
        toggleHidden:()=>{amountsHidden=!amountsHidden;localStorage.setItem('forma.amounts.hidden',String(amountsHidden));},
      });
    }).catch(()=>{if(host.isConnected&&generation===version)host.textContent='Bitcoin Mainnet workspace could not load. Reload to retry.';});
  }
  if (solanaMainnet && active && view!=='overview') {
    const wallet = active, version = generation, host = document.getElementById('solana-mainnet-panel')!;
    void import('./solana-mainnet-ui').then(module => {
      if (!host.isConnected || generation !== version || active !== wallet || selectedNetwork !== 'sol-mainnet') return;
      disposeSolanaMainnet = module.mountSolanaMainnet(host, wallet, {
        current: () => active === wallet && generation === version && selectedNetwork === 'sol-mainnet',
        hidden: () => amountsHidden, page: view,
        toggleHidden: () => { amountsHidden = !amountsHidden; localStorage.setItem('forma.amounts.hidden',String(amountsHidden)); },
      });
    }).catch(() => { if (host.isConnected && generation === version) host.textContent = 'Solana Mainnet workspace could not load. Reload to retry.'; });
  }
  if (additionalEvm && active && view!=='overview' && isAdditionalEvm(selectedNetwork)) {
    const network = selectedNetwork, wallet = active, version = generation;
    const host = document.getElementById('evm-panel')!;
    void import('./evm-workspace').then(module => {
      if (generation !== version || !host.isConnected || active !== wallet) return;
      disposeEvm = module.mountEvmWorkspace(host, network, wallet, {
        current: () => generation === version && active === wallet && selectedNetwork === network,
        hidden: () => amountsHidden, page: view,
        toggleHidden: () => { amountsHidden = !amountsHidden; localStorage.setItem('forma.amounts.hidden', String(amountsHidden)); },
      });
    }).catch(() => { if (host.isConnected) host.textContent = 'Unable to load this testnet. Refresh to retry.'; });
  }
  if (native && active && view!=='overview' && (selectedNetwork === 'btc' || selectedNetwork === 'sol')) {
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
    if (isNetworkId(choice)) selectNetwork(choice, supportsPage(choice, view) ? view : 'overview');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-account-network]').forEach(button => button.onclick = () => {
    const choice = button.dataset.accountNetwork;
    if (choice && isNetworkId(choice)) selectNetwork(choice, 'overview');
  });
  if (available && view === 'ledger') disposeLedger = mountLedger(document.getElementById('ledger-panel')!, provider, () => navigate('overview'));
  document.getElementById('open-watch')?.addEventListener('click', () => { notice = 'Signing wallet remains locked. Watch-only mode needs no unlock.'; navigate('watch'); });
  if (selectedNetwork === 'eth' && available && view === 'watch') disposeWatch = mountWatch(document.getElementById('watch-panel')!, watchReadApi(provider), () => navigate('overview'), () => amountsHidden);
  if ((selectedNetwork === 'btc' || selectedNetwork === 'sol') && (view === 'watch' || (active && view === 'contacts'))) {
    const network=selectedNetwork, mode=view as 'watch'|'contacts', version=generation, owner=active?.address || '';
    const host=document.getElementById(mode === 'watch' ? 'watch-panel' : 'contacts-panel')!;
    void import('./native-public').then(module => {
      if (generation !== version || !host.isConnected) return;
      disposeWatch=module.mountNativePublic(host,network,mode,owner,()=>amountsHidden);
    }).catch(()=>{ if(host.isConnected) host.textContent='Network accounts could not load. Refresh to retry.'; });
  }
  if (selectedNetwork === 'eth' && active && view === 'contacts') mountContacts(active.address, render, text => { notice = text; const el = document.getElementById('notice'); if (el) el.textContent = text; });
  if (active && view === 'market') disposeMarket = mountMarket(document.getElementById('market-panel')!, selectedNetwork);
  if (active && view === 'tokens') {
    const host = document.getElementById('evm-panel') || document.getElementById('tokens-panel') || document.getElementById('multi-panel') || document.getElementById('tron-panel');
    if (host) {
      const guide = document.createElement('details'); guide.className = 'card token-guide';
      guide.innerHTML = '<summary>How do tokens and networks work?</summary><div class="capability-diagram" role="img" aria-label="Choose the correct network, discover or import a verified contract, then track its balance"><div><strong>Choose network</strong><small>Assets live on a particular chain</small></div><span aria-hidden="true">→</span><div><strong>Find or import</strong><small>Verify issuer + contract/mint</small></div><span aria-hidden="true">→</span><div><strong>Track & receive</strong><small>Keep the right native fee token</small></div></div><p>USDT on Ethereum, Polygon and TRON uses different contracts. Native SOL belongs to Solana; an EVM token named SOL is separate. Discovery can find candidates automatically, but names and symbols do not prove authenticity. Importing does not bridge funds.</p><p><a href="/learn/tokens.html" target="_blank" rel="noopener noreferrer">Read the token and network guide ↗</a></p>';
      host.before(guide);
    }
  }
  mountEntryTabs(root); enhanceCards(root);
}

function activityRows() {
  const filtered = filterLoadedActivity(history, active!.address, activityFilter, activityStatus, activityQuery);
  if (!filtered.length) return '<div class="empty"><h3>No matching activity.</h3><p>Clear your search, change the filter, or load more activity. Search covers loaded ETH records only.</p></div>';
  return filtered.map(t => {
    const sent = t.from.toLowerCase() === active!.address.toLowerCase();
    return `<div class="history-row">${assetLogo('ETH', true)}<div class="history-identity"><strong>${sent?'Sent ETH':'Received ETH'}</strong><p>${escape(new Date(t.timestamp).toLocaleString())}${t.kind==='internal'?' · Internal transfer':''}</p><code>${escape(short(sent?t.to||'Contract creation':t.from))}</code><a target="_blank" rel="noopener noreferrer" href="https://sepolia.etherscan.io/tx/${escape(t.hash)}">View transaction ↗</a></div><div class="history-value"><strong><span data-activity-amount="${escape(t.id)}">${amountsHidden?'••••••':escape(formatEther(t.value))}</span> ETH</strong><span class="status-chip status-${escape(t.status)}">${escape(t.status)}</span></div></div>`;
  }).join('');
}

function phraseRestoreForm() { return phraseRestoreMarkup(); }

function savedWalletButtons() {
  const saved = vaults();
  return Object.keys(saved).slice(0,100).map((key,index)=>{
    const current=saved[key]===localStorage.getItem(VAULT_KEY);
    return `<button type="button" class="quiet saved-wallet-choice" data-wallet="${escape(key)}" ${current?'disabled':''}><span class="saved-wallet-icon" aria-hidden="true">◇</span><span class="saved-wallet-identity"><strong>Wallet ${index+1}</strong><small>${escape(savedWalletLabel(key,saved[key]))}</small></span><span class="saved-wallet-state">${current?'Current':'Unlock →'}</span></button>`;
  }).join('') || '<div class="saved-wallet-empty"><span aria-hidden="true">◇</span><strong>No other wallets saved</strong><p>Create or restore another wallet here. Each keeps its own recovery phrase and local password.</p></div>';
}

function settings() {
  const saved = vaults();
  const current = active!.address.toLowerCase().replace(/^0x/, '');
  return `<section id="settings-panel" class="card"><h2>Recovery & import</h2><p>Phrase-backed backups preserve the recovery phrase for supported networks. Addresses depend on each chain and derivation path. Imported Ethereum keys without a phrase remain Ethereum-only.</p><p>Only use fresh test wallets here. Importing preserves the current encrypted wallet.</p>
  ${accountsMarkup()}
  <h3>Recovery phrase</h3><p>Your recovery phrase controls this wallet on every compatible network. Keep it offline and never share it.</p>
  <form id="reveal-form"><label for="reveal-password">Re-enter this wallet’s password</label><input type="password" id="reveal-password" autocomplete="current-password" required><button class="quiet">Reveal recovery phrase for 30 seconds</button></form><div id="phrase-display" aria-live="off"></div>
  ${phraseRestoreForm()}
  <h3>Import an encrypted JSON backup</h3><form id="import-form"><label for="keystore">Encrypted keystore JSON</label><input id="keystore" type="file" accept=".json,application/json" required><label for="import-password">Backup password</label><input id="import-password" type="password" autocomplete="current-password" required><label for="backup-local-password">New local password (12+ characters)</label><input id="backup-local-password" type="password" minlength="12" autocomplete="new-password" required><label for="backup-local-confirm">Confirm new local password</label><input id="backup-local-confirm" type="password" autocomplete="new-password" required><button class="quiet">Import encrypted backup</button></form>
  <h3>Verify your backup</h3><p>Decrypt a downloaded backup and check its address against this wallet. Verification does not switch wallets.</p><form id="verify-backup-form"><label for="verify-backup-file">Backup JSON to verify</label><input id="verify-backup-file" type="file" accept=".json,application/json" required><label for="verify-backup-password">Password for this backup</label><input id="verify-backup-password" type="password" autocomplete="off" required><button class="quiet">Verify backup</button></form>
  <h3>Change wallet password</h3><p>Changes local encryption for this wallet only. Previously downloaded backups still use their original passwords. Download and verify a new backup afterwards.</p><form id="change-password-form"><label for="change-old-password">Current local password</label><input id="change-old-password" type="password" autocomplete="current-password" required><label for="change-new-password">New wallet password (12+ characters)</label><input id="change-new-password" type="password" minlength="12" autocomplete="new-password" required><label for="change-confirm-password">Confirm new wallet password</label><input id="change-confirm-password" type="password" autocomplete="new-password" required><button class="quiet">Change password & lock</button></form>
  <h3>Saved wallets</h3><p>Switching locks the active wallet. Unlock the selected wallet with its own password.</p><div class="saved-wallets">${savedWalletButtons()}</div>${createAnotherWalletMarkup()}</section>`;
}

function onboarding(hasVault: boolean) {
  return `<div class="setup-grid auth-shell"><section class="card setup auth-card"><div class="auth-card-top"><span class="auth-lock" aria-hidden="true">&#9635;</span><span class="auth-local">LOCAL WALLET</span></div><div class="icon-large" hidden>◈</div><div class="eyebrow">YOUR OWN SPACE</div><h1>${hasVault ? 'Welcome back.' : 'Start with ownership.'}</h1><p>${hasVault ? 'Unlock the wallet saved on this browser.' : 'No recovery phrase yet? Forma generates a new 12-word phrase for you. Choose a password, then save and verify your new words.'}</p>
  <form id="vault-form"><label for="password">${hasVault ? 'Wallet password' : 'Create a password'}</label><input id="password" type="password" minlength="12" required autocomplete="${hasVault ? 'current-password' : 'new-password'}" placeholder="Enter your wallet password"><p class="auth-input-hint">Your password unlocks this device only.</p>
  ${hasVault ? '' : '<label for="confirm">Confirm password</label><input id="confirm" type="password" required autocomplete="new-password" placeholder="Enter your password again"><label class="check"><input id="understand" type="checkbox" required> I will download my encrypted backup. There is no password reset.</label>'}
  <button class="primary" ${busy ? 'disabled' : ''}>${busy ? 'Working securely…' : hasVault ? 'Unlock wallet →' : 'Create wallet →'}</button></form><div class="auth-encryption-note"><span aria-hidden="true">&#9671;</span> Encrypted locally. Your keys stay with you.</div><div class="auth-alternatives"><span>OTHER WAYS TO EXPLORE</span><button id="open-ledger" class="auth-option"><span class="auth-option-icon" aria-hidden="true">&#9636;</span><span><strong>Connect a Ledger</strong><small>Approve on your device</small></span><span aria-hidden="true">&#8599;</span></button><button id="open-watch" class="auth-option"><span class="auth-option-icon" aria-hidden="true">&#9678;</span><span><strong>Watch an address</strong><small>Explore without importing keys</small></span><span aria-hidden="true">&#8599;</span></button></div>
  <p class="hint">One recovery phrase for supported networks. Mainnet and testnet balances are separate.</p>${'<details class="auth-disclosure restore-backup"><summary><span class="disclosure-icon" aria-hidden="true">↥</span><span><strong>Restore from a backup</strong><small>Import your encrypted wallet JSON</small></span></summary><p class="hint">Choose your encrypted backup and enter its original password. Set a password for this browser.</p><form id="import-form"><label for="keystore">Encrypted keystore JSON</label><input id="keystore" type="file" accept=".json,application/json" required><label for="import-password">Backup password</label><input id="import-password" type="password" required autocomplete="current-password"><label for="backup-local-password">New local password (12+ characters)</label><input id="backup-local-password" type="password" minlength="12" autocomplete="new-password" required><label for="backup-local-confirm">Confirm new local password</label><input id="backup-local-confirm" type="password" autocomplete="new-password" required><button class="quiet" '+(busy ? 'disabled' : '')+'>Restore encrypted wallet →</button></form></details>'}<details class="restore-phrase auth-disclosure"><summary><span class="disclosure-icon" aria-hidden="true">◇</span><span><strong>Restore with a recovery phrase</strong><small>Use the words from your wallet</small></span></summary>${phraseRestoreForm()}</details><details class="auth-disclosure"><summary><span class="disclosure-icon" aria-hidden="true">▤</span><span><strong>Saved wallets</strong><small>Switch to a wallet stored on this browser</small></span></summary><p class="hint">Switching locks the current session. Use the selected wallet’s password to unlock it.</p><div class="saved-wallets">${savedWalletButtons()}</div>${createAnotherWalletMarkup()}</details></section>
  <section class="intro auth-story"><div class="eyebrow">YOUR WALLET WORKSPACE</div><h2>Your wallet.<br><span>Your way.</span></h2><p>A calm place for your digital assets.<br>Built around one simple idea: you hold the keys.</p><div class="auth-art" aria-hidden="true"><div class="auth-orbit orbit-one"></div><div class="auth-orbit orbit-two"></div><div class="auth-vault"><div class="auth-vault-brand">&#9672; forma</div><span>SELF-CUSTODY</span><div class="auth-key">&#9671;</div><div class="auth-vault-bottom"><span>YOUR KEYS</span><span>YOUR CONTROL</span></div></div><div class="auth-art-tag"><i class="dot"></i> On your device</div></div><div class="auth-promises"><div><b>01</b><strong>Created by you</strong><p>Keys generated locally.</p></div><div><b>02</b><strong>Protected locally</strong><p>An encrypted local vault.</p></div><div><b>03</b><strong>Recovered by you</strong><p>Your backup. Your access.</p></div></div><p class="auth-story-note">Self-custody prototype. Keep a separate backup for every wallet.</p></section></div>`;
}

function walletContextMarkup(){return `<section class="wallet-context" aria-label="Wallet context"><label>Environment<select id="environment-select" aria-label="Wallet environment"><option value="mainnet" ${isMainnetNetwork(selectedNetwork)?'selected':''}>Mainnet</option><option value="testnet" ${!isMainnetNetwork(selectedNetwork)?'selected':''}>Testnet</option></select></label><label>Account<select id="account-select" aria-label="Wallet account">${accountOptions()}</select></label><label class="context-chain">Network<select id="network-select" aria-label="Wallet network">${networkOptionsMarkup()}</select></label></section>`;}
function networkOptionsMarkup() { return preferredNetworks(localStorage, selectedNetwork).filter(id=>isMainnetNetwork(id)===isMainnetNetwork(selectedNetwork)).map(id => `<option data-network-icon="${networkIconPath(id)}" value="${id}" ${id === selectedNetwork ? 'selected' : ''}>${escape(networkLabel(id))}</option>`).join(''); }
function networkAccountsMarkup() { const choices = [...new Set([selectedNetwork, ...preferredNetworks(localStorage, selectedNetwork).filter(id=>isMainnetNetwork(id)===isMainnetNetwork(selectedNetwork))])].slice(0, 6); return `<section id="network-accounts" class="card"><div class="section-heading"><h2>Your networks</h2><button id="manage-networks" type="button" class="quiet">Manage ${networkIds.filter(id=>isMainnetNetwork(id)===isMainnetNetwork(selectedNetwork)).length} networks</button></div><p>Choose a chain. Your environment selection applies across the wallet.</p><div class="account-network-grid">${choices.map(id => `<button type="button" class="quiet" data-account-network="${id}" aria-pressed="${id === selectedNetwork}">${networkLogo(id)} ${escape(networkLabel(id))}</button>`).join('')}</div></section>`; }

function dashboard() {
  const address = active!.address;
  return `${networkAccountsMarkup()}<div class="wallet-grid" id="wallet-summary"><section class="balance-card"><div class="eyebrow">AVAILABLE BALANCE <button id="amount-visibility" class="amount-visibility" aria-pressed="${amountsHidden}">${amountsHidden ? 'Show balance' : 'Hide balance'}</button></div><div class="balance">${assetLogo('ETH', true)} <span id="balance-value">${amountsHidden ? '&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;' : escape(balance)}</span> <small>ETH</small></div><p>Sepolia ETH · Test tokens have no monetary value</p><div class="balance-actions"><button id="send-focus" class="primary">↗ Send</button><button id="receive-focus" class="quiet">↙ Receive</button><button id="refresh" class="text-button">↻ Refresh</button></div><div class="address-bar"><span>${escape(currentAccount() ? accountLabel(currentAccount()!) : 'WALLET ADDRESS')} · ADDRESS</span><code>${short(address)}</code><button id="copy" aria-label="Copy wallet address">⧉</button></div><button id="manage-accounts" class="text-button account-manage-link">Manage accounts →</button></section>
  <section class="card security"><div class="eyebrow">WALLET HEALTH <span class="dot"></span></div><h2>Keep ownership.<br>Keep a backup.</h2><p>Your encrypted backup and password recover this wallet if this browser’s data is lost.</p><p role="status">${escape(backupGuidance(backupStage(localStorage, active!.address, localStorage.getItem(VAULT_KEY) || '')))}</p><button id="backup" class="quiet">↓ Download encrypted backup</button><button id="backup-verify" class="quiet">Verify a saved backup</button>${(currentGroup()?.accounts.length ?? 1) > 1 ? '<small>Backups download the active account only. Back up each imported account under Recovery &amp; import.</small>' : ''}<small>Status is a local reminder, not a guarantee of recovery. Auto-locks after 5 minutes idle or when hidden.</small></section></div>
  <section class="card holdings-shell" id="overview-assets"></section><div class="wallet-grid lower" id="transfer-panels"><section class="card" id="send-card"><div class="section-heading"><h2>Send crypto</h2><span>↗</span></div><form id="send-form"><label for="eth-contact">Saved recipient (optional)</label><select id="eth-contact">${contactOptions(active!.address)}</select><label for="recipient">Recipient address</label><input id="recipient" placeholder="0x…" required autocomplete="off"><label for="amount">Amount in Sepolia ETH</label><input id="amount" placeholder="0.00" inputmode="decimal" required autocomplete="off"><p class="hint">Only send on Ethereum Sepolia. Check the full address.</p><button class="primary" ${busy ? 'disabled' : ''}>Review transfer →</button></form><div id="review"></div></section>
  <section class="card" id="receive-card"><div class="section-heading"><h2>Receive crypto</h2><span>↙</span></div><div class="receive"><canvas id="qr"></canvas><strong>Ethereum Sepolia only</strong><code>${address}</code><button id="save-receive-qr" type="button" class="quiet">Save receive QR image</button><p>Share your public address. Never share your password or backup.</p><a href="https://sepolia.etherscan.io/address/${address}" target="_blank" rel="noopener noreferrer">View full activity on explorer ↗</a></div></section></div>
  <section class="card activity activity-workspace" id="activity-panel"><div class="section-heading"><h2>Transaction history</h2><button id="history-refresh" class="quiet">Refresh activity</button></div><div class="activity-toolbar"><div class="filter-tabs" aria-label="Filter activity">${['all','received','sent'].map(filter => `<button data-filter="${filter}" class="${activityFilter === filter ? 'is-active' : ''}" aria-pressed="${activityFilter === filter}">${filter[0].toUpperCase()+filter.slice(1)}</button>`).join('')}</div><span class="activity-count">${history.length} indexed records</span></div><p class="hint">${escape(historyNotice)}</p><h3>Locally submitted ETH</h3><p class="hint">Unknown does not mean failed. Refresh activity to check receipts. Do not retry an uncertain transfer automatically.</p><div id="eth-submissions">${nativeSubmissionRows()}</div><div id="replacement-review"></div><div class="history-controls"><label for="activity-status">Status<select id="activity-status">${["all", "pending", "confirmed", "failed"].map(status => `<option value="${status}" ${activityStatus === status ? "selected" : ""}>${status === "all" ? "All statuses" : status[0].toUpperCase() + status.slice(1)}</option>`).join("")}</select></label><label for="activity-search">Search loaded activity<input id="activity-search" type="search" maxlength="100" autocomplete="off" placeholder="Address or transaction hash" value="${escape(activityQuery)}"></label></div><p class="hint">Searches loaded ETH records only. Load older activity to extend results.</p><div id="activity-search-results">${activityRows()}</div>${cursors.some(Boolean) ? '<button id="load-more" class="quiet">Load older activity</button>' : ''}<p><a href="https://eth-sepolia.blockscout.com/address/${address}" target="_blank" rel="noopener noreferrer">View complete activity on explorer</a></p></section>`;

}

async function task(fn: () => Promise<void>, form?: HTMLFormElement) {
  if (busy) return;
  form?.querySelector('.form-error')?.remove();
  form?.querySelectorAll('[aria-invalid]').forEach(input => {
    input.removeAttribute('aria-invalid');
    if (input.getAttribute('aria-describedby') === `${form.id}-error`) input.removeAttribute('aria-describedby');
  });
  busy = true;
  root.setAttribute('aria-busy', 'true');
  root.querySelectorAll<HTMLButtonElement>('form button, #refresh, #history-refresh, #load-more').forEach(b => { b.disabled = true; b.dataset.originalText = b.textContent || ''; b.textContent = 'Working...'; });
  try { await fn(); } catch (error) {
    notice = walletErrorMessage(error);
    const el = document.getElementById('notice');
    if (form?.isConnected) {
      const message = document.createElement('p');
      message.className = 'form-error';
      message.id = `${form.id}-error`;
      message.setAttribute('role', 'alert');
      message.tabIndex = -1;
      message.textContent = notice;
      const password = form.querySelector<HTMLInputElement>('input[autocomplete="current-password"]');
      if (password && /incorrect (?:wallet )?password/i.test(notice)) {
        password.setAttribute('aria-invalid', 'true');
        password.setAttribute('aria-describedby', message.id);
        (password.closest('.password-field') || password).after(message);
      } else form.prepend(message);
      message.focus({ preventScroll: true });
      message.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (el) el.textContent = '';
    } else if (el) el.textContent = notice;
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
  const restoreForm=document.getElementById('phrase-form') as HTMLFormElement|null;if(restoreForm)mountRecoveryWords(restoreForm);
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => {
    input.dataset.secretInput='true';
    input.spellcheck=false; input.setAttribute('autocapitalize','off');input.setAttribute('autocorrect','off');
    if(input.id==='import-phrase' || input.id==='seed-passphrase' || input.closest('.recovery-word-grid')) return;
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
  document.getElementById('environment-select')?.addEventListener('change',event=>{const live=(event.target as HTMLSelectElement).value==='mainnet';const next=environmentNetwork(selectedNetwork,live);notice=networkAsset(next).name!==networkAsset(selectedNetwork).name?'This chain has no supported counterpart in that environment. Ethereum selected.':'';selectNetwork(next,supportsPage(next,view)?view:'overview');});
  document.getElementById('account-select')?.addEventListener('change', event => switchAccount((event.target as HTMLSelectElement).value));
  root.querySelectorAll<HTMLButtonElement>('[data-switch-account]').forEach(button => button.onclick = () => switchAccount(button.dataset.switchAccount!));
  root.querySelectorAll<HTMLButtonElement>('[data-backup-account]').forEach(button => button.onclick = () => {
    try { downloadAccountBackup(button.dataset.backupAccount!); }
    catch (error) { notice = error instanceof Error ? error.message : 'Backup unavailable.'; const el = document.getElementById('notice'); if (el) el.textContent = notice; }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-rename-account]').forEach(button => button.onclick = () => {
    const select = document.getElementById('rename-account-address') as HTMLSelectElement | null;
    if (select) { select.value = button.dataset.renameAccount!; select.dispatchEvent(new Event('change', { bubbles: true })); }
    document.getElementById('rename-account-nickname')?.focus();
    document.getElementById('rename-account-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('manage-accounts')?.addEventListener('click', () => navigate('settings'));
  document.getElementById('add-account-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const passwordInput = document.getElementById('add-account-password') as HTMLInputElement;
      const password = passwordInput.value;
      passwordInput.value = '';
      const version = generation;
      await verifyWalletPassword(password);
      if (version !== generation || !active) return;
      if (!isHdWallet(active)) throw new Error('This account has no usable recovery phrase. Import a private key instead.');
      const index = Number(field('add-account-index'));
      if (!Number.isInteger(index) || index < 0 || index > 100) throw new Error('Account index must be between 0 and 100.');
      const group = currentGroup() ?? adoptActiveVault(localStorage, localStorage.getItem(VAULT_KEY)!);
      if (group.accounts.some(account => account.kind === 'hd' && account.index === index)) throw new Error(`Account index ${index} is already added.`);
      const derived = deriveHdAccount(active, index);
      if (findAccount(loadAccountRegistry(localStorage), derived.address)) throw new Error('This account is already in your wallet.');
      const encrypted = await derived.encrypt(password);
      if (version !== generation || !active) return;
      registerNewAccount(localStorage, group.primary, { address: derived.address, kind: 'hd', index, addedAt: new Date().toISOString() }, encrypted);
      accountSession.set(derived.address.toLowerCase(), derived);
      localStorage.setItem(VAULT_KEY, encrypted);
      clearSecrets();
      generation++;
      active = derived;
      exactBalance = null;
      balance = '—';
      loadHistory();
      notice = `${accountLabel({ kind: 'hd', index })} added and selected. Download its encrypted backup or add another account.`;
      render();
      const added = generation;
      void refresh().catch(() => { if (added !== generation) return; notice = 'Account added. Balance unavailable; try Refresh.'; render(); });
    }, event.currentTarget as HTMLFormElement);
  });
  document.getElementById('import-key-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      const keyInput = document.getElementById('import-key') as HTMLInputElement;
      const raw = keyInput.value;
      keyInput.value = '';
      if (!(document.getElementById('import-key-ack') as HTMLInputElement)?.checked) throw new Error('Acknowledge that the recovery phrase does not cover imported keys.');
      const nickname = nicknameInput(field('import-key-nickname'));
      const passwordInput = document.getElementById('import-key-password') as HTMLInputElement;
      const password = passwordInput.value;
      passwordInput.value = '';
      const version = generation;
      await verifyWalletPassword(password);
      if (version !== generation || !active) return;
      const wallet = privateKeyInput(raw);
      if (findAccount(loadAccountRegistry(localStorage), wallet.address)) throw new Error('This account is already in your wallet.');
      const group = currentGroup() ?? adoptActiveVault(localStorage, localStorage.getItem(VAULT_KEY)!);
      const encrypted = await wallet.encrypt(password);
      if (version !== generation || !active) return;
      registerNewAccount(localStorage, group.primary, { address: wallet.address, kind: 'imported', ...(nickname ? { nickname } : {}), addedAt: new Date().toISOString() }, encrypted);
      accountSession.set(wallet.address.toLowerCase(), wallet);
      localStorage.setItem(VAULT_KEY, encrypted);
      clearSecrets();
      generation++;
      active = wallet;
      exactBalance = null;
      balance = '—';
      loadHistory();
      notice = 'Private key imported and selected. The recovery phrase does not cover it; download its encrypted backup.';
      render();
      const importedVersion = generation;
      void refresh().catch(() => { if (importedVersion !== generation) return; notice = 'Imported. Balance unavailable; try Refresh.'; render(); });
    }, event.currentTarget as HTMLFormElement);
  });
  document.getElementById('rename-account-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      renameAccount(localStorage, field('rename-account-address'), field('rename-account-nickname'));
      notice = 'Account nickname updated.';
      render();
    }, event.currentTarget as HTMLFormElement);
  });
  document.getElementById('reveal-key-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      clearSecrets();
      const input = document.getElementById('reveal-key-password') as HTMLInputElement;
      const password = input.value;
      input.value = '';
      const version = generation;
      const wallet = await verifyWalletPassword(password);
      if (version !== generation || !active || view !== 'settings') return;
      const target = document.getElementById('key-display');
      if (!target) return;
      const warning = document.createElement('p');
      warning.textContent = 'Never share this key. Anyone with it can control this account.';
      const code = document.createElement('code');
      code.className = 'private-key';
      code.textContent = wallet.privateKey;
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'quiet';
      hide.textContent = 'Hide private key';
      hide.onclick = clearSecrets;
      target.replaceChildren(warning, code, hide);
      revealTimer = setTimeout(clearSecrets, 30000);
    }, event.currentTarget as HTMLFormElement);
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
    }, event.currentTarget as HTMLFormElement);
  });
  document.getElementById('change-password-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async () => {
      if (!active) return;
      const oldPassword = field('change-old-password'), password = field('change-new-password'), confirmation = field('change-confirm-password');
      for (const id of ['change-old-password', 'change-new-password', 'change-confirm-password']) (document.getElementById(id) as HTMLInputElement).value = '';
      const version = generation, address = active.address;
      const group = currentGroup() ?? adoptActiveVault(localStorage, localStorage.getItem(VAULT_KEY)!);
      const updates: { address: string; vaultKey: string; oldJson: string; nextJson: string }[] = [];
      for (const account of group.accounts) {
        const vaultKey = account.address.toLowerCase() === address.toLowerCase() ? VAULT_KEY : accountVaultKey(account.address);
        const oldJson = localStorage.getItem(vaultKey);
        if (!oldJson) throw new Error(`Encrypted copy for ${accountLabel(account)} is missing. Unlock that account and change its password separately.`);
        updates.push({ address: account.address, vaultKey, oldJson, nextJson: await changePassword(oldJson, oldPassword, password, confirmation, account.address) });
      }
      if (generation !== version || !active) return;
      commitGroupPassword(localStorage, VAULT_KEY, WALLET_LIST, address, updates);
      accountSession.clear();
      lock(); notice = 'Password changed for every account in this wallet. Unlock with your new password, then download and verify new backups. Older backups keep their old passwords.'; render();
    }, event.currentTarget as HTMLFormElement);
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
    }, event.currentTarget as HTMLFormElement);
  });
  document.getElementById('new-wallet-form')?.addEventListener('submit', event => {
    event.preventDefault();
    void task(async()=>{
      const password=field('additional-password'),confirm=field('additional-confirm');
      (document.getElementById('additional-password') as HTMLInputElement).value='';
      (document.getElementById('additional-confirm') as HTMLInputElement).value='';
      validatePassword(password,confirm);
      const version=generation,wallet=Wallet.createRandom(),json=await wallet.encrypt(password);
      if(version!==generation)return;
      saveVault(json,wallet.address);
      clearSecrets();generation++;active=wallet;exactBalance=null;balance='—';
      pendingSeed={address:wallet.address,phrase:wallet.mnemonic!.phrase};
      const createdVersion=generation;
      await hydrateAccounts(password,wallet,json);
      if(generation!==createdVersion||active!==wallet)return;
      loadHistory();view='settings';notice='Separate wallet created. Your previous wallets are saved. Download and verify this wallet’s backup.';render();
    },event.currentTarget as HTMLFormElement);
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
      phraseInput.form?.querySelectorAll<HTMLInputElement>('.recovery-word-grid input').forEach(input=>input.value='');
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
      await hydrateAccounts(password, wallet, json);
      loadHistory();
      view = 'overview';
      notice = 'Wallet imported. Check its address and download its encrypted backup.';
      render();
      try { await refresh(); } catch { notice = 'Imported. Network unavailable; try Refresh.'; render(); }
    }, event.currentTarget as HTMLFormElement);
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
        pendingSeed={address:wallet.address,phrase:wallet.mnemonic!.phrase};
        active = wallet;
      }
      if (active) await hydrateAccounts(password, active, localStorage.getItem(VAULT_KEY)!);
      if (version !== generation) return;
      loadHistory();
      notice = vault ? 'Wallet unlocked.' : 'Wallet created. Save your recovery phrase and encrypted backup.';
      render();
      try { await refresh(); } catch { notice = 'Wallet ready. Balance unavailable: check your RPC connection and refresh.'; render(); }
    }, event.currentTarget as HTMLFormElement);
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
      await hydrateAccounts(localPassword, wallet, encrypted);
      loadHistory();
      notice = 'Wallet restored. Phrase-backed backups also restore Bitcoin Testnet and Solana Devnet accounts.';
      render();
      try { await refresh(); } catch { notice = 'Restored. Balance unavailable; try Refresh.'; render(); }
    }, event.currentTarget as HTMLFormElement);
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
      try { await provider.call({ from: wallet.address, to, value }); }
      catch (error) { throw new Error(simulationFailure(error)); }
      const gasLimit = await signer.estimateGas({ to, value });
      const fees = await provider.getFeeData();
      if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error('Network fee unavailable. Try again.');
      const quotes = feePresets({ maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
      const walletBalance = await provider.getBalance(wallet.address);
      const nonce = await provider.getTransactionCount(wallet.address, 'pending');
      const localRows = nativeSubmissions(wallet.address);
      assertNonceFree(localRows, nonce);
      const earlier = earlierPendingCount(localRows, nonce);
      affordable(value, gasLimit, quotes.market.maxFeePerGas, walletBalance);
      if (version !== generation || revision !== sendRevision || !active) return;
      pending = { to, value, gasLimit, nonce, maxFeePerGas: quotes.market.maxFeePerGas, maxPriorityFeePerGas: quotes.market.maxPriorityFeePerGas, chainId: CHAIN_ID, type: 2 };
      pendingReviewedAt = Date.now();
      const feeOption = (preset: FeePreset, label: string) => `<option value="${preset}" ${preset === 'market' ? 'selected' : ''}>${label} · max ${formatGwei(quotes[preset].maxFeePerGas)} gwei</option>`;
      document.getElementById('review')!.innerHTML = `<div class="review"><strong>Review your Sepolia transfer</strong><p>To: <code>${to}</code></p><p>Amount: ${formatEther(value)} ETH</p><p>Nonce: <strong>${nonce}</strong></p><label for="fee-choice">Network fee</label><select id="fee-choice">${feeOption('slow', 'Economy')}${feeOption('market', 'Suggested')}${feeOption('fast', 'Priority')}</select><p class="hint" id="fee-detail"></p><p class="recipient-warning" id="fee-warning" hidden></p><p class="recipient-warning">${escape(recipientWarning)}</p>${earlier ? `<p class="recipient-warning">${earlier} earlier local transfer${earlier === 1 ? ' is' : 's are'} still unconfirmed. This transfer uses nonce ${nonce} and can only be mined after ${earlier === 1 ? 'it' : 'them'}.</p>` : ''}<p class="hint">Simulation: eth_call did not revert. This only detects reverts; it is not a balance-change preview or PPOM-grade coverage.</p><p class="hint">Network: Ethereum Sepolia. Review expires in 2 minutes.</p><label class="check"><input id="verify-eth-recipient" type="checkbox"> I verified the full recipient address and network.</label><button id="confirm-send" class="primary" type="button">Confirm & send test ETH</button><button id="cancel-send" class="quiet" type="button">Cancel</button></div>`;
      const feeChoice = document.getElementById('fee-choice') as HTMLSelectElement;
      const feeDetail = document.getElementById('fee-detail')!;
      const feeWarning = document.getElementById('fee-warning')!;
      const confirmSend = document.getElementById('confirm-send') as HTMLButtonElement;
      const applyFee = () => {
        if (!pending) return;
        const quote = quotes[feeChoice.value as FeePreset];
        pending.maxFeePerGas = quote.maxFeePerGas;
        pending.maxPriorityFeePerGas = quote.maxPriorityFeePerGas;
        const total = gasLimit * quote.maxFeePerGas;
        feeDetail.textContent = `Priority tip ${formatGwei(quote.maxPriorityFeePerGas)} gwei · worst-case fee ${formatEther(total)} ETH.`;
        const short = value + total > walletBalance;
        feeWarning.hidden = !short;
        feeWarning.textContent = short ? 'This fee option exceeds your current Sepolia balance. Choose a lower fee.' : '';
        confirmSend.disabled = short;
      };
      feeChoice.addEventListener('change', applyFee);
      applyFee();
      document.getElementById('cancel-send')!.onclick = () => { pending = null; document.getElementById('review')!.replaceChildren(); };
      confirmSend.onclick = () => void task(async () => withActiveSepoliaLock(async () => {
        if (!active || !pending) throw new Error('Review the transfer again.');
        assertFreshReview(pendingReviewedAt);
        if (!(document.getElementById('verify-eth-recipient') as HTMLInputElement)?.checked) throw new Error('Confirm that you verified the full recipient address.');
        const transaction = pending;
        const version = generation;
        const signer = active.connect(provider);
        requireSepolia((await provider.getNetwork()).chainId);
        if (version !== generation || !active) throw new Error('Wallet locked. Review the transfer again.');
        const currentNonce = await provider.getTransactionCount(active.address, 'pending');
        if (currentNonce !== transaction.nonce) throw new Error(`The account’s pending nonce changed (reviewed ${transaction.nonce}, now ${currentNonce}). Review the transfer again.`);
        assertSepoliaNonceFree(active.address, transaction.nonce!);
        affordable(BigInt(transaction.value ?? 0n), BigInt(transaction.gasLimit!), BigInt(transaction.maxFeePerGas!), await provider.getBalance(active.address));
        // Consume the review once. A provider timeout can be ambiguous; do not retry automatically.
        pending = null;
        document.getElementById('review')!.replaceChildren();
        const populated = await signer.populateTransaction(transaction);
        if (populated.nonce !== transaction.nonce) throw new Error('The nonce changed before signing. Nothing was sent.');
        if(version!==generation || !active) throw new Error('Wallet locked or view changed. Nothing was signed.');
        assertFreshReview(pendingReviewedAt);
        const signed = await signer.signTransaction(populated);
        assertSignedMatchesReview(signed, { ...transaction, nonce: populated.nonce }, signer.address);
        assertFreshReview(pendingReviewedAt);
        if (version !== generation || !active) throw new Error('Wallet locked or view changed. Transfer was not broadcast.');
        const entry: TokenSubmission = { hash: keccak256(signed), contract: ZeroAddress, to: String(transaction.to), amount: String(transaction.value), decimals: 18, symbol: 'ETH', nonce: populated.nonce ?? undefined, timestamp: new Date().toISOString(), status: 'unknown', gasLimit: BigInt(populated.gasLimit ?? transaction.gasLimit!).toString(), maxFeePerGas: BigInt(populated.maxFeePerGas ?? transaction.maxFeePerGas!).toString(), maxPriorityFeePerGas: BigInt(populated.maxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas!).toString(), intent: 'transfer' };
        const sent = await submitTracked(signed, entry, row => {
          const rows = strictSepoliaJournal(localStorage, nativeJournalKey(signer.address));
          localStorage.setItem(nativeJournalKey(signer.address), JSON.stringify(retainSepoliaSubmission(rows, row)));
          if (version === generation) { const list = document.getElementById('eth-submissions'); if (list) list.innerHTML = nativeSubmissionRows(); }
        }, raw => provider.broadcastTransaction(raw), () => version === generation && !!active && revision === sendRevision);
        if (version !== generation) return;
        history = mergeActivity(history, [{ id: sent.hash, hash: sent.hash, from: active!.address, to: String(transaction.to), value: String(transaction.value), timestamp: new Date().toISOString(), status: 'pending', kind: 'transaction' }]);
        persistHistory();
        notice = 'Transfer submitted. Check the explorer for confirmation before sending again.';
        render();
      }));
    });
  });
}
try { if (preserveImportedWallet(localStorage, WALLET_LIST)) notice = 'An older wallet was preserved in Saved wallets. Use the normal wallet switch and unlock flow.'; } catch { notice = 'An older wallet could not be added to Saved wallets. Its original encrypted storage is preserved.'; }
render();
installSelectPickers(root);
installHoldingsControls(root);
root.addEventListener('click', event => {
  if ((event.target as HTMLElement).closest('[data-open-tokens]') && active && supportsPage(selectedNetwork, 'tokens')) navigate('tokens');
});


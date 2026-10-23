import { HDNodeWallet, Wallet, formatUnits } from 'ethers';
import { base64 } from '@scure/base';
import { Transaction as SolTransaction } from '@solana/web3.js';
import QRCode from 'qrcode';
import { validatePassword, importPhrase } from './wallet';
import { validateKeystore } from './security';
import { walletErrorMessage } from './error-message';
import { MULTI_VAULT, BTC_PATH, SOL_PATH, unifiedRoot, deriveMulti, clearMulti, units, encodeMultiBackup, decodeMultiBackup, bitcoinPlan, signBitcoin, solTransfer, signSol, btcRecipient, solRecipient, type MultiKeys, type Chain, type BitcoinPlan } from './multichain-core';
import { assertTestnet, readMultiBalance, bitcoinFunding, assertUnspent, solRpc, safeNumber, broadcastBitcoin, broadcastSol, solSimulate, submissionStatus, multiExplorer } from './multichain-network';

type Submission = { chain: Chain; owner: string; id: string; to: string; amount: string; fee: string; when: string; status: 'unknown' | 'pending' | 'confirmed' | 'failed' };
const JOURNAL = 'forma.multichain.testnet-submissions.v1';
type Review = { chain: Chain; owner: string; to: string; amount: bigint; fee: bigint; created: number; bitcoin?: BitcoinPlan; sol?: SolTransaction; expiry?: number };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function multiMarkup() { return '<section id="multi-panel" class="multichain-workspace"><p role="status">Loading Bitcoin & Solana wallets…</p></section>'; }
export function parseMultiJournal(value: unknown): Submission[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).filter((row): row is Submission => row && ['btc', 'sol'].includes(row.chain)
    && typeof row.owner === 'string' && row.owner.length <= 90 && typeof row.to === 'string' && row.to.length <= 90
    && typeof row.id === 'string' && (row.chain === 'btc' ? /^[a-f0-9]{64}$/.test(row.id) : /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(row.id))
    && typeof row.amount === 'string' && typeof row.fee === 'string' && /^\d{1,20}$/.test(row.amount) && /^\d{1,20}$/.test(row.fee)
    && typeof row.when === 'string' && Number.isFinite(Date.parse(row.when)) && ['unknown', 'pending', 'confirmed', 'failed'].includes(row.status));
}
export type SharedWalletSession = {
  wallet: Wallet | HDNodeWallet; chain: Chain; current(): boolean; lock(): void; backup(): void;
  select(chain: Chain): void; hideBalance(): boolean; toggleBalance(): void;
};
export function mountMulti(host: HTMLElement, primary?: SharedWalletSession) {
  let keys: MultiKeys | undefined, chain: Chain = primary?.chain ?? 'btc', disposed = false, busy = false, epoch = 0;
  let balance: bigint | undefined, unconfirmed = 0n, review: Review | undefined, hiddenBalance = true;
  let note = primary ? 'These accounts share your unlocked wallet’s recovery phrase and encrypted backup.' : 'Older imported BTC/SOL wallet. Its original vault, password and addresses are preserved.';
  let loadingPrimary = !!primary;
  let timer: ReturnType<typeof setTimeout>;
  const stored = () => localStorage.getItem(MULTI_VAULT);
  const owner = (which = chain) => keys ? which === 'btc' ? keys.btcAddress : keys.solAddress : '';
  const decimals = (which = chain) => which === 'btc' ? 8 : 9;
  const symbol = (which = chain) => which === 'btc' ? 'tBTC' : 'devSOL';
  const amount = (value: bigint, which = chain) => formatUnits(value, decimals(which));
  const current = (version: number) => !disposed && version === epoch && !!keys && (!primary || primary.current());
  const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
  function journal() { try { return parseMultiJournal(JSON.parse(localStorage.getItem(JOURNAL) || '[]')); } catch { return []; } }
  function record(row: Submission) {
    localStorage.setItem(JOURNAL, JSON.stringify([row, ...journal().filter(r => r.id !== row.id || r.chain !== row.chain)].slice(0, 100)));
  }
  function touch() { clearTimeout(timer); if (keys) timer = setTimeout(lock, 300000); }
  function lock() { epoch++; clearTimeout(timer); clearMulti(keys); keys = undefined; review = undefined; balance = undefined; unconfirmed = 0n; busy = false; note = 'Bitcoin & Solana vault locked.'; if (!disposed) { if (primary) primary.lock(); else paint(); } }
  function paint() {
    if (disposed) return;
    if (primary) hiddenBalance = primary.hideBalance();
    const rows = journal().filter(row => row.owner === owner() && row.chain === chain);
    host.innerHTML = `<div class="section-heading"><div><div class="eyebrow">${primary ? 'ONE WALLET · TEST NETWORKS' : 'OLDER IMPORTED WALLET'}</div><h2>${primary ? 'One wallet. Three networks.' : 'Your original BTC & SOL accounts.'}</h2></div>${keys && !primary ? '<button type="button" data-multi="lock" class="quiet">Lock imported wallet</button>' : ''}</div>
      <p>Bitcoin Testnet3 and Solana Devnet only. Native transfers only; no SPL tokens, mainnet, swaps or hardware signing.</p><p id="multi-notice" class="ledger-status" role="status" aria-live="polite">${escape(note)}</p>
      ${!keys ? primary ? `<section class="card"><h3>${loadingPrimary ? 'Opening your network accounts…' : 'Shared accounts unavailable for this import'}</h3><p>${loadingPrimary ? 'Deriving the first Bitcoin and Solana accounts from your unlocked recovery phrase.' : escape(note)}</p><p>Your Ethereum wallet remains available. No new phrase or vault has been created.</p></section>` : entry() : `<div class="filter-tabs" aria-label="Choose test network"><button type="button" data-multi="btc" aria-pressed="${chain === 'btc'}" class="${chain === 'btc' ? 'is-active' : ''}">Bitcoin Testnet</button><button type="button" data-multi="sol" aria-pressed="${chain === 'sol'}" class="${chain === 'sol' ? 'is-active' : ''}">Solana Devnet</button></div>
      <div class="multichain-grid"><section class="card"><div class="eyebrow">${chain === 'btc' ? 'BITCOIN TESTNET3 · NOT MAINNET' : 'SOLANA DEVNET · NOT MAINNET'}</div><h3>Receive ${symbol()}</h3><p class="multi-balance">${hiddenBalance ? '••••••' : balance === undefined ? '—' : escape(amount(balance))} ${symbol()}</p><button type="button" data-multi="privacy" class="quiet">${hiddenBalance ? 'Show' : 'Hide'} balance</button><button type="button" data-multi="refresh" class="quiet">Refresh balance & submissions</button>${chain === 'btc' ? `<p>Confirmed balance only. Pending net change: ${hiddenBalance ? '••••••' : escape(amount(unconfirmed))} tBTC. Only confirmed outputs can be spent.</p>` : ''}<canvas id="multi-qr" aria-label="Public testnet receive address QR code"></canvas><code class="multi-address">${escape(owner())}</code><button type="button" data-multi="copy" class="quiet">Copy public address</button><p><a href="${multiExplorer(chain, 'address', owner())}" target="_blank" rel="noopener noreferrer">View address on testnet explorer ↗</a></p><p>Use this address only on the network shown above. A Solana address alone does not identify its network.</p><p class="hint">First account only: ${chain === 'btc' ? BTC_PATH : SOL_PATH}. No account discovery or change-address scanning. ${chain === 'btc' ? 'Bitcoin change returns to this same address.' : 'Native SOL transfers only.'}</p></section>
      <section class="card"><h3>Send ${symbol()}</h3><form id="multi-send"><label for="multi-to">${chain === 'btc' ? 'Bitcoin Testnet recipient (tb1q)' : 'Solana Devnet recipient'}</label><input id="multi-to" required autocomplete="off" maxlength="90"><label for="multi-amount">Amount in ${symbol()}</label><input id="multi-amount" required inputmode="decimal" maxlength="40">${chain === 'btc' ? '<label for="multi-rate">Fee rate (sat/vB, 1–100)</label><input id="multi-rate" required type="number" min="1" max="100" step="1" value="2"><p class="hint">Manual fee rate. Confirmation time is not guaranteed.</p>' : ''}<button class="primary" type="submit">Review testnet transfer</button></form><div id="multi-review">${reviewMarkup()}</div></section></div>
      <section class="card"><h3>${primary ? 'One backup for all three networks' : 'Original imported-wallet backup'}</h3><p>${primary ? 'Your primary encrypted wallet backup preserves the recovery phrase for Ethereum, Bitcoin Testnet and Solana Devnet. Use the same local password; no second vault is required.' : 'This older wallet has its own phrase and password. Keep its original backup; its accounts cannot be merged into a different phrase without changing addresses.'}</p><button type="button" data-multi="backup" class="quiet">${primary ? 'Download wallet encrypted backup' : 'Download imported BTC & SOL backup'}</button><p>Auto-locks after 5 minutes idle or when hidden. Save the backup before adding test funds.</p></section>
      <section class="card"><h3>Locally submitted ${symbol()} transfers</h3><p>Shows this browser’s submissions only. For incoming and older transactions, use the address explorer. Unknown does not mean failed. Pending or unknown submissions block another send on that account until resolved; do not retry blindly.</p>${rows.map(row => `<div class="tx"><div><strong>${hiddenBalance ? '••••••' : escape(amount(BigInt(row.amount)))} ${symbol()} · ${row.status}</strong><p>Fee: ${hiddenBalance ? '••••••' : escape(amount(BigInt(row.fee)))} ${symbol()}</p><p>${escape(new Date(row.when).toLocaleString())}</p><code class="multi-address">To: ${escape(row.to)}</code></div><a href="${multiExplorer(chain, 'tx', row.id)}" target="_blank" rel="noopener noreferrer">Check transaction ↗</a></div>`).join('') || '<p>No locally recorded submissions for this account.</p>'}</section>`}`;
    if (keys) {
      const version = epoch;
      void QRCode.toCanvas(host.querySelector<HTMLCanvasElement>('#multi-qr')!, chain === 'btc' ? `bitcoin:${owner()}` : owner(), { width: 180, margin: 4 }).catch(() => { if (current(version)) message('QR unavailable. Use the full public address.'); });
    }
    controls();
  }
  function entry() {
    const password = (id: string, label: string, fresh = false) => `<label for="${id}">${label}</label><input type="password" id="${id}" required ${fresh ? 'minlength="12"' : ''} autocomplete="${fresh ? 'new-password' : 'current-password'}">`;
    if (stored()) return `<section class="card"><h3>Unlock Bitcoin & Solana</h3><p>Use this separate vault’s password. It may differ from your Ethereum wallet password.</p><form id="multi-unlock">${password('multi-password', 'BTC & SOL vault password')}<button class="primary">Unlock testnet vault</button></form></section>`;
    return `<div class="multichain-grid"><section class="card" hidden><h3>Create a fresh testnet vault</h3><p>One encrypted backup, two network-specific accounts. Store test assets only.</p><form id="multi-create">${password('multi-create-password', 'New vault password (12+ characters)', true)}${password('multi-create-confirm', 'Confirm password', true)}<label class="check"><input type="checkbox" required> I will save the encrypted backup. There is no password reset.</label><button class="primary">Create BTC & SOL test wallets</button></form></section>
      <section class="card"><h3>Restore a BTC & SOL backup</h3><form id="multi-import"><label for="multi-file">Forma BTC & SOL encrypted JSON</label><input id="multi-file" type="file" accept=".json,application/json" required>${password('multi-backup-password', 'Original backup password')}${password('multi-local-password', 'New local password (12+ characters)', true)}${password('multi-local-confirm', 'Confirm new local password', true)}<button class="quiet">Restore encrypted backup</button></form><details><summary>Import a fresh test recovery phrase</summary><p>Only the first accounts at ${BTC_PATH} and ${SOL_PATH} are supported. Other wallets may use different paths. BIP-39 passphrases are not supported here.</p><form id="multi-phrase-import"><label for="multi-phrase">Test recovery phrase</label><input id="multi-phrase" type="password" autocomplete="off" spellcheck="false" required>${password('multi-phrase-password', 'New vault password (12+ characters)', true)}${password('multi-phrase-confirm', 'Confirm password', true)}<label class="check"><input type="checkbox" required> This is a disposable test phrase, not a Ledger or mainnet phrase.</label><button class="quiet">Import test phrase</button></form></details></section></div>`;
  }
  function reviewMarkup() {
    if (!review) return '';
    const r = review;
    return `<div class="ledger-address-box"><h3>Review ${r.chain === 'btc' ? 'Bitcoin Testnet' : 'Solana Devnet'} transfer</h3><p>From: <code class="multi-address">${escape(r.owner)}</code></p><p>To: <code class="multi-address">${escape(r.to)}</code></p><p>Amount: ${amount(r.amount, r.chain)} ${symbol(r.chain)}<br>Network fee: ${amount(r.fee, r.chain)} ${symbol(r.chain)}<br>Total: ${amount(r.amount + r.fee, r.chain)} ${symbol(r.chain)}</p>${r.bitcoin ? `<p>Change to your address: ${amount(r.bitcoin.change, 'btc')} tBTC. ${r.bitcoin.inputs.length} confirmed input(s).</p>` : '<p>Blockhash expires. If it expires, review a fresh transaction.</p>'}<label class="check"><input type="checkbox" id="multi-ack"> I checked the full recipient and the test network.</label><button type="button" data-multi="sign" class="primary">Sign & send testnet transfer</button><button type="button" data-multi="cancel" class="quiet">Cancel review</button></div>`;
  }
  function message(text: string) { note = text; if (!disposed) { const el = host.querySelector('#multi-notice'); if (el) el.textContent = text; } }
  function controls() {
    host.setAttribute('aria-busy', String(busy));
    host.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy && button.dataset.multi !== 'lock'; });
    host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(input => { input.disabled = busy; });
  }
  async function run(work: () => Promise<void>) {
    if (busy || disposed) return;
    const version = epoch; busy = true; controls();
    try { await work(); } catch (error) { if (!disposed && version === epoch) message(walletErrorMessage(error)); }
    finally { if (!disposed && version === epoch) { busy = false; controls(); touch(); } }
  }
  async function openVault(vault: string, password: string) {
    validateKeystore(vault);
    const root = await Wallet.fromEncryptedJson(vault, password);
    if (!(root instanceof HDNodeWallet) || !root.mnemonic) throw new Error('This backup does not contain the recovery phrase needed for BTC & SOL.');
    return root;
  }
  async function activate(root: HDNodeWallet, vault: string, version: number, save: boolean) {
    if (disposed || version !== epoch) return;
    const next = await deriveMulti(root);
    if (disposed || version !== epoch) { clearMulti(next); return; }
    try { if (save) {
      if (!navigator.locks) throw new Error('This browser cannot safely coordinate vault creation across tabs. Use a current browser over HTTPS or localhost.');
      await navigator.locks.request(`${MULTI_VAULT}:create`, () => {
        if (disposed || version !== epoch) throw new Error('Wallet session changed.');
        if (stored()) throw new Error('Another tab created a vault. Reload to unlock it.');
        localStorage.setItem(MULTI_VAULT, vault);
      });
    } }
    catch (error) { clearMulti(next); throw error; }
    if (disposed || version !== epoch) { clearMulti(next); return; }
    clearMulti(keys); keys = next; review = undefined; balance = undefined;
    note = save ? 'Test wallets ready. Download the encrypted backup before adding funds.' : 'BTC & SOL vault unlocked. Refresh to read the selected network.';
    paint(); touch();
  }
  async function refresh() {
    if (!keys) return;
    const version = epoch, selected = chain, account = owner();
    review = undefined;
    const result = await readMultiBalance(selected, keys);
    if (!current(version)) return;
    balance = result.confirmed; unconfirmed = result.unconfirmed;
    let unavailable = 0;
    for (const row of journal().filter(r => r.owner === account && r.chain === selected).slice(0, 20)) {
      try { const status = await submissionStatus(selected, row.id); if (!current(version)) return; record({ ...row, status }); }
      catch { unavailable++; }
    }
    if (current(version)) { note = unavailable ? 'Balance loaded. Some submission statuses are unavailable; verify on the explorer.' : 'Balance and available submission statuses refreshed.'; paint(); }
  }
  function unresolved() { return journal().some(row => row.owner === owner() && row.chain === chain && ['pending', 'unknown'].includes(row.status)); }
  async function prepare(to: string, text: string, rate: string) {
    if (!keys) return;
    review = undefined;
    host.querySelector('#multi-review')?.replaceChildren();
    if (unresolved()) throw new Error('Resolve the pending or uncertain submission on this account before making another transfer. Refresh and check the explorer.');
    const version = epoch, selected = chain, account = owner(), value = units(text, decimals());
    if (selected === 'btc') btcRecipient(to); else solRecipient(to);
    let next: Review;
    if (selected === 'btc') {
      const funding = await bitcoinFunding(keys); if (!current(version)) return;
      const plan = bitcoinPlan(keys, to, value, Number(rate), funding);
      next = { chain: selected, owner: account, to: plan.to, amount: value, fee: plan.fee, created: Date.now(), bitcoin: plan };
    } else {
      await assertTestnet('sol'); if (!current(version)) return;
      const block = (await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]))?.value;
      if (typeof block?.blockhash !== 'string') throw new Error('Invalid Solana blockhash.');
      const expiry = safeNumber(block.lastValidBlockHeight);
      const tx = solTransfer(keys, to, value, block.blockhash);
      const quote = await solRpc('getFeeForMessage', [base64.encode(tx.serializeMessage()), { commitment: 'confirmed' }]);
      const fee = BigInt(safeNumber(quote?.value));
      if (fee > 1000000n) throw new Error('Solana fee exceeds the 0.001 SOL test-wallet limit.');
      const funds = await readMultiBalance('sol', keys);
      if (value + fee > funds.confirmed) throw new Error('Not enough Devnet SOL for amount and network fee.');
      next = { chain: selected, owner: account, to: to.trim(), amount: value, fee, sol: tx, expiry, created: Date.now() };
    }
    if (current(version)) { review = next; paint(); }
  }
  async function send(ack: boolean) {
    if (!keys || !review || !ack) throw new Error('Review the transfer and acknowledge the full recipient and test network.');
    const version = epoch, r = review, k = keys;
    const fresh = () => { if (!current(version) || chain !== r.chain || owner() !== r.owner || Date.now() - r.created > 90000) throw new Error('Review expired or wallet changed. Nothing further was broadcast.'); };
    fresh(); if (unresolved()) throw new Error('A pending or uncertain transfer must be resolved first.');
    review = undefined; host.querySelector('#multi-review')?.replaceChildren();
    await assertTestnet(r.chain); fresh();
    let signed: { raw: string | Uint8Array; id: string };
    if (r.chain === 'btc' && r.bitcoin) {
      for (const input of r.bitcoin.inputs) { await assertUnspent(input.txid, input.vout); fresh(); }
      signed = signBitcoin(r.bitcoin, k);
    } else if (r.chain === 'sol' && r.sol) {
      if (safeNumber(await solRpc('getBlockHeight', [{ commitment: 'confirmed' }])) > r.expiry!) throw new Error('Solana blockhash expired. Review again.');
      fresh(); signed = await signSol(r.sol, k, r.to, r.amount); fresh();
      await solSimulate(signed.raw as Uint8Array); fresh();
    } else throw new Error('Missing transaction review.');
    await assertTestnet(r.chain); fresh();
    const row: Submission = { chain: r.chain, owner: r.owner, id: signed.id, to: r.to, amount: String(r.amount), fee: String(r.fee), status: 'unknown', when: new Date().toISOString() };
    // A durable write must succeed before network broadcast. Never auto-retry.
    record(row); fresh();
    try {
      if (r.chain === 'btc') await broadcastBitcoin(signed.raw as string, signed.id);
      else await broadcastSol(signed.raw as Uint8Array, signed.id);
      record({ ...row, status: 'pending' });
      if (current(version)) { note = 'Submitted to the test network. Refresh for confirmation; do not send it again.'; paint(); }
    } catch {
      if (current(version)) { note = 'Submission result is uncertain and recorded. Check the transaction on the explorer and refresh before retrying.'; paint(); }
    }
  }
  const submit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if (!['multi-create', 'multi-unlock', 'multi-import', 'multi-phrase-import', 'multi-send'].includes(form.id)) return;
    event.preventDefault(); if (busy) return;
    const version = epoch;
    if (form.id === 'multi-create') {
      const password = field('multi-create-password').value, confirm = field('multi-create-confirm').value;
      form.reset(); void run(async () => { validatePassword(password, confirm); const root = HDNodeWallet.createRandom(); const vault = await root.encrypt(password); await activate(root, vault, version, true); });
    } else if (form.id === 'multi-unlock') {
      const password = field('multi-password').value, vault = stored(); form.reset();
      void run(async () => { if (!vault) throw new Error('No saved BTC & SOL vault.'); const root = await openVault(vault, password); await activate(root, vault, version, false); });
    } else if (form.id === 'multi-import') {
      const file = field('multi-file').files?.[0], password = field('multi-backup-password').value, local = field('multi-local-password').value, confirm = field('multi-local-confirm').value;
      form.reset(); void run(async () => { validatePassword(local, confirm); if (!file || file.size > 100000) throw new Error('Choose a backup smaller than 100 KB.'); const root = await openVault(decodeMultiBackup(await file.text()), password); if (disposed || version !== epoch) return; const vault = await root.encrypt(local); await activate(root, vault, version, true); });
    } else if (form.id === 'multi-phrase-import') {
      const phrase = field('multi-phrase').value, password = field('multi-phrase-password').value, confirm = field('multi-phrase-confirm').value;
      form.reset(); void run(async () => { validatePassword(password, confirm); const root = importPhrase(phrase, '', 0); const vault = await root.encrypt(password); await activate(root, vault, version, true); });
    } else {
      const to = field('multi-to').value, value = field('multi-amount').value, rate = host.querySelector<HTMLInputElement>('#multi-rate')?.value || '';
      void run(() => prepare(to, value, rate));
    }
  };
  const click = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest<HTMLButtonElement>('button[data-multi]')?.dataset.multi;
    if (!action || disposed) return;
    if (action === 'lock') { lock(); return; }
    if (busy) return;
    if (action === 'btc' || action === 'sol') { epoch++; chain = action; primary?.select(action); review = undefined; balance = undefined; unconfirmed = 0n; note = 'Network selected. Refresh to load its balance.'; paint(); touch(); }
    if (action === 'privacy') { if (primary) primary.toggleBalance(); else hiddenBalance = !hiddenBalance; paint(); }
    if (action === 'cancel') { review = undefined; paint(); }
    if (action === 'refresh') void run(refresh);
    if (action === 'copy') void run(async () => { await navigator.clipboard.writeText(owner()); message('Public testnet address copied.'); });
    if (action === 'sign') {
      const ack = host.querySelector<HTMLInputElement>('#multi-ack')?.checked === true;
      void run(async () => {
        if (!navigator.locks) throw new Error('This browser cannot safely coordinate sends across tabs. Use a current browser over HTTPS or localhost.');
        await navigator.locks.request(`${MULTI_VAULT}:send:${chain}:${owner()}`, { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('Another tab is sending from this account. Check its result first.');
          await send(ack);
        });
      });
    }
    if (action === 'backup') void run(async () => {
      if (primary) { primary.backup(); return; }
      const vault = stored(); if (!keys || !vault) return;
      const url = URL.createObjectURL(new Blob([encodeMultiBackup(vault)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'forma-bitcoin-solana-testnet-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message('Encrypted backup download requested. Keep it and its password private; verify recovery in another browser.');
    });
  };
  const edit = (event: Event) => { if ((event.target as Element).closest('#multi-send')) { review = undefined; host.querySelector('#multi-review')?.replaceChildren(); } };
  const hidden = () => { if (document.hidden) lock(); };
  const storage = (event: StorageEvent) => { if (event.key === MULTI_VAULT || event.key === null || event.key === JOURNAL) lock(); };
  host.addEventListener('submit', submit); host.addEventListener('click', click); host.addEventListener('input', edit);
  host.addEventListener('pointerdown', touch); host.addEventListener('keydown', touch);
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', lock); window.addEventListener('storage', storage);
  paint();
  if (primary) {
    const version = epoch;
    void (async () => {
      try {
        const derived = await deriveMulti(unifiedRoot(primary.wallet));
        if (disposed || version !== epoch || !primary.current()) { clearMulti(derived); return; }
        keys = derived; loadingPrimary = false; paint(); touch();
      } catch (error) {
        if (!disposed && version === epoch && primary.current()) { loadingPrimary = false; note = walletErrorMessage(error); paint(); }
      }
    })();
  }
  return () => { disposed = true; lock(); host.removeEventListener('submit', submit); host.removeEventListener('click', click); host.removeEventListener('input', edit); host.removeEventListener('pointerdown', touch); host.removeEventListener('keydown', touch); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', lock); window.removeEventListener('storage', storage); };
}

import { enhanceCards } from './ui-panels';
import { HDNodeWallet, Wallet, formatUnits } from 'ethers';
import { base64 } from '@scure/base';
import { Transaction as SolTransaction } from '@solana/web3.js';
import QRCode from 'qrcode';
import { parsePublicAccounts, publicAccountsKey } from './native-public';
import { readMint, readTokenAccount, parseMints, splKey, splUnits, splTransaction, signSpl, type SplMint } from './sol-tokens';
import { validatePassword, importPhrase } from './wallet';
import { validateKeystore } from './security';
import { walletErrorMessage } from './error-message';
import { MULTI_VAULT, BTC_PATH, SOL_PATH, unifiedRoot, deriveMulti, clearMulti, units, encodeMultiBackup, decodeMultiBackup, bitcoinPlan, signBitcoin, solTransfer, signSol, btcRecipient, solRecipient, type MultiKeys, type Chain, type BitcoinPlan } from './multichain-core';
import { assertTestnet, readMultiBalance, readMultiActivity, type NetworkActivity, bitcoinFunding, assertUnspent, solRpc, safeNumber, broadcastBitcoin, broadcastSol, solSimulate, submissionStatus, multiExplorer } from './multichain-network';

type Submission = { chain: Chain; owner: string; id: string; to: string; amount: string; fee: string; when: string; status: 'unknown' | 'pending' | 'confirmed' | 'failed'; mint?: string; decimals?: number };
const JOURNAL = 'forma.multichain.testnet-submissions.v1';
type Review = { chain: Chain; owner: string; to: string; amount: bigint; fee: bigint; created: number; bitcoin?: BitcoinPlan; sol?: SolTransaction; expiry?: number; mint?: SplMint };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function multiMarkup() { return '<section id="multi-panel" class="multichain-workspace"><p role="status">Loading Bitcoin & Solana wallets…</p></section>'; }
export function parseMultiJournal(value: unknown): Submission[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).filter((row): row is Submission => row && ['btc', 'sol'].includes(row.chain)
    && typeof row.owner === 'string' && row.owner.length <= 90 && typeof row.to === 'string' && row.to.length <= 90
    && typeof row.id === 'string' && (row.chain === 'btc' ? /^[a-f0-9]{64}$/.test(row.id) : /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(row.id))
    && typeof row.amount === 'string' && typeof row.fee === 'string' && /^\d{1,20}$/.test(row.amount) && /^\d{1,20}$/.test(row.fee)
    && (row.mint === undefined || (row.chain === 'sol' && typeof row.mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint) && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 18))
    && typeof row.when === 'string' && Number.isFinite(Date.parse(row.when)) && ['unknown', 'pending', 'confirmed', 'failed'].includes(row.status));
}
export type SharedWalletSession = {
  wallet: Wallet | HDNodeWallet; chain: Chain; current(): boolean; lock(): void; backup(): void;
  select(chain: Chain): void; hideBalance(): boolean; toggleBalance(): void;
  page?: string;
};
export function mountMulti(host: HTMLElement, primary?: SharedWalletSession) {
  let keys: MultiKeys | undefined, chain: Chain = primary?.chain ?? 'btc', disposed = false, busy = false, epoch = 0;
  let balance: bigint | undefined, unconfirmed = 0n, review: Review | undefined, hiddenBalance = true;
  let note = primary ? 'These accounts share your unlocked wallet’s recovery phrase and encrypted backup.' : 'Older imported BTC/SOL wallet. Its original vault, password and addresses are preserved.';
  let loadingPrimary = !!primary;
  let recent: NetworkActivity[] = [], recentNotice = 'Refresh to load recent network transactions.';
  let timer: ReturnType<typeof setTimeout>;
  const stored = () => localStorage.getItem(MULTI_VAULT);
  const owner = (which = chain) => keys ? which === 'btc' ? keys.btcAddress : keys.solAddress : '';
  const decimals = (which = chain) => which === 'btc' ? 8 : 9;
  const symbol = (which = chain) => which === 'btc' ? 'tBTC' : 'devSOL';
  const amount = (value: bigint, which = chain) => formatUnits(value, decimals(which));
  const current = (version: number) => !disposed && version === epoch && !!keys && (!primary || primary.current());
  const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
  let historyQuery='', historyStatus='all';
  const tokenBalances = new Map<string,string>();
  let tokenRefreshPending=false;
  const tokenRefreshQueue:string[]=[];
  function showTokenBalance(mint:string) {
    host.querySelectorAll<HTMLElement>('[data-spl-balance]').forEach(el=>{if(el.dataset.splBalance===mint) el.textContent=hiddenBalance?'••••••':tokenBalances.get(mint)||'Loading balance…';});
  }
  async function refreshTokenBalances(mints=trackedMints()) {
    if(!keys) return;
    for(const mint of mints) if(!tokenRefreshQueue.includes(mint)) tokenRefreshQueue.push(mint);
    if(tokenRefreshPending) return;
    tokenRefreshPending=true; const version=epoch, account=owner('sol');
    try { await Promise.all(Array.from({length:Math.min(3,mints.length)},async()=>{
      while(tokenRefreshQueue.length && current(version)) {
        const mint=tokenRefreshQueue.shift()!; tokenBalances.set(mint,'Loading balance…'); showTokenBalance(mint);
        try { const info=await readMint(mint), result=await readTokenAccount(account,info); if(!current(version)) return;
          tokenBalances.set(mint,`${formatUnits(result.amount,info.decimals)} SPL units${result.exists?'':' · no associated account yet'}`);
        } catch { if(!current(version)) return; tokenBalances.set(mint,'Balance unavailable · retry refresh'); }
        showTokenBalance(mint);
      }
    })); } finally {tokenRefreshPending=false;}
  }
  function trackedMints() { try { return parseMints(JSON.parse(localStorage.getItem(splKey(owner('sol'))) || '[]')); } catch { return []; } }
  function tokenMarkup() {
    const mints=trackedMints();
    let tokenContacts=[] as ReturnType<typeof parsePublicAccounts>;
    try { tokenContacts=parsePublicAccounts('sol',JSON.parse(localStorage.getItem(publicAccountsKey('sol','contacts',primary?.wallet.address || '')) || '[]')); } catch { /* Ignore invalid public records. */ }
    return `<div class="asset-workspace"><section class="card asset-inventory"><div class="section-heading"><div><div class="eyebrow">YOUR ASSETS · SOLANA DEVNET</div><h2>Token collection</h2></div><div class="asset-row-actions"><span class="pill">${mints.length} / 25 tracked</span><button class="quiet" type="button" data-multi="refresh-tokens">↻ Refresh tokens</button></div></div><p>Track classic SPL tokens by their mint address. Test tokens have no monetary value.</p><details class="asset-import" ${mints.length ? '' : 'open'}><summary>＋ Add a token</summary><form id="spl-import"><label for="spl-mint">Devnet mint address</label><input id="spl-mint" placeholder="Paste the full mint address" maxlength="44" required autocomplete="off"><button class="primary">Validate & add mint</button></form><p class="hint">Mint addresses identify tokens. Names and symbols are not verified. Token-2022 is not supported.</p></details><div class="asset-list">${mints.map(m=>`<div class="asset-row"><span class="asset-avatar" aria-hidden="true">◎</span><div class="asset-identity"><strong>SPL token</strong><code title="${escape(m)}">${escape(m)}</code><span class="asset-quantity" data-spl-balance="${escape(m)}">${hiddenBalance ? '••••••' : escape(tokenBalances.get(m)||'Loading balance…')}</span></div><div class="asset-row-actions"><button class="quiet" type="button" data-spl-refresh="${escape(m)}">↻ Refresh</button><a href="${multiExplorer('sol','address',m)}" target="_blank" rel="noopener noreferrer">Explorer ↗</a><button class="text-button" type="button" data-spl-remove="${escape(m)}">Remove</button></div></div>`).join('') || '<div class="empty asset-empty"><span class="asset-avatar" aria-hidden="true">◎</span><h3>Your tokens belong here.</h3><p>Add a Devnet mint to see its balance and send test tokens.</p></div>'}</div></section><div class="portfolio-grid lower asset-transfer-grid"><section class="card"><div class="section-heading"><h2>Send a token</h2><span aria-hidden="true">↗</span></div><form id="spl-send"><label for="spl-selected">Token mint</label><select id="spl-selected" required><option value="">Select a tracked mint</option>${mints.map(m=>`<option value="${escape(m)}">${escape(m)}</option>`).join('')}</select><label for="spl-contact">Saved recipient (optional)</label><select id="spl-contact"><option value="">Enter an address manually</option>${tokenContacts.map(c=>`<option value="${escape(c.address)}">${escape(c.name)} · ${escape(c.address)}</option>`).join('')}</select><label for="spl-to">Recipient wallet address</label><input id="spl-to" placeholder="Solana Devnet wallet address" required maxlength="44" autocomplete="off"><label for="spl-amount">Token amount</label><input id="spl-amount" placeholder="0.00" required inputmode="decimal" maxlength="40"><p class="hint">Fees are paid in devSOL. The recipient must have an existing associated token account for this mint.</p><button class="primary">Review token transfer →</button></form><div id="multi-review">${reviewMarkup()}</div></section><section class="card asset-receive"><div class="section-heading"><h2>Receive tokens</h2><span aria-hidden="true">↙</span></div><div class="asset-avatar" aria-hidden="true">◎</div><h3>One Solana address.</h3><p>Receive supported SPL tokens at your Solana Devnet wallet address.</p><code class="multi-address">${escape(owner('sol'))}</code><button type="button" data-multi="copy" class="quiet">Copy wallet address</button><p class="hint">Choose Solana Devnet at the sender. The sender must create your associated token account if needed. Importing a mint only changes your display.</p><details><summary>Supported accounts & storage</summary><p class="hint">Classic SPL associated accounts only. Token-2022, NFT-specific transfers and account creation are not supported. Mint addresses are saved unencrypted in this browser. Removing a mint does not move tokens.</p></details></section></div></div>`;
  }
  function historyMarkup(rows: Submission[]) {
    return `<section class="card activity-workspace" data-multi-part="history"><div class="section-heading"><div><div class="eyebrow">YOUR TRANSACTIONS</div><h2>Transaction history</h2></div><button type="button" class="quiet" data-multi="refresh">↻ Refresh activity</button></div><div class="history-controls"><label>Status<select id="native-history-status">${['all','pending','unknown','confirmed','failed'].map(status=>`<option value="${status}" ${historyStatus===status?'selected':''}>${status==='all'?'All statuses':status[0].toUpperCase()+status.slice(1)}</option>`).join('')}</select></label><label>Search loaded activity<input id="native-history-search" type="search" maxlength="100" placeholder="Address, mint or transaction ID" value="${escape(historyQuery)}"></label></div><p class="hint">Search covers loaded records only. Amounts show supported transfers or token balance changes. Bitcoin net changes include fees. Unavailable details are never shown as zero. Unknown does not mean failed.</p><div id="native-history-results">${historyResults(rows)}</div><p><a href="${multiExplorer(chain,'address',owner())}" target="_blank" rel="noopener noreferrer">View complete activity on explorer ↗</a></p></section>`;
  }
  function historyResults(rows: Submission[]) {
    const matches=(row:{id:string;status:string;to?:string;mint?:string})=>(historyStatus==='all'||row.status===historyStatus) && [row.id,row.to||'',row.mint||''].some(text=>text.toLowerCase().includes(historyQuery.toLowerCase()));
    const local=rows.filter(matches), network=recent.filter(matches);
    return `<div class="history-section-heading"><h3>Locally submitted transfers</h3><span class="pill">${local.length} records</span></div>${local.map(row=>`<div class="history-row"><span class="asset-avatar" aria-hidden="true">↗</span><div class="history-identity"><strong>Sent ${row.mint?'SPL token':symbol()}</strong><p>${escape(new Date(row.when).toLocaleString())}</p><code>To: ${escape(row.to)}</code>${row.mint?`<code>Mint: ${escape(row.mint)}</code>`:''}<a href="${multiExplorer(chain,'tx',row.id)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${hiddenBalance?'••••••':escape(row.mint?formatUnits(BigInt(row.amount),row.decimals!):amount(BigInt(row.amount)))} ${row.mint?'SPL units':symbol()}</strong><span class="status-chip status-${row.status}">${row.status}</span><small>Fee: ${hiddenBalance?'••••••':escape(amount(BigInt(row.fee)))} ${symbol()}</small></div></div>`).join('') || '<div class="empty"><h3>No matching submissions</h3><p>Your transfers from this browser will appear here.</p></div>'}<div class="history-section-heading"><h3>Network activity</h3><span class="pill">${network.length} loaded</span></div><p class="hint">${escape(recentNotice)}</p>${network.map(row=>`<div class="history-row"><span class="asset-avatar" aria-hidden="true">⇄</span><div class="history-identity"><strong>Network transaction</strong><p>${row.timestamp?escape(new Date(row.timestamp).toLocaleString()):'Awaiting confirmation time'}</p><code>${escape(row.id)}</code><a href="${multiExplorer(chain,'tx',row.id)}" target="_blank" rel="noopener noreferrer">View details ↗</a></div><div class="history-value">${row.movements?.length ? row.movements.map(m=>`<strong>${m.direction==='change'?'Net change':m.direction==='sent'?(m.mint?'Token decrease':'Sent'):(m.mint?'Token increase':'Received')} ${hiddenBalance?'••••••':(m.direction==='change'?(m.amount<0n?'−':'+'):'')+formatUnits(m.amount<0n?-m.amount:m.amount,m.decimals)} ${m.asset}</strong>${m.mint?`<code class="history-mint">Mint: ${escape(m.mint)}</code>`:''}`).join('') : `<small>${row.status==='failed'?'No successful transfer':'Amount unavailable'}</small>`}<span class="status-chip status-${row.status}">${row.status}</span></div></div>`).join('') || '<div class="empty"><h3>No matching network activity</h3><p>Refresh to load recent records or check the explorer.</p></div>'}`;
  }
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
    if (keys && primary?.page === 'tokens') {
      host.innerHTML=`<p id="multi-notice" role="status">${escape(note)}</p>${tokenMarkup()}`;
      const contact=host.querySelector<HTMLSelectElement>('#spl-contact'); if(contact) contact.onchange=()=>{field('spl-to').value=contact.value;review=undefined;host.querySelector('#multi-review')?.replaceChildren();};
      enhanceCards(host); controls(); return;
    }
    host.innerHTML = `<div class="section-heading"><div><div class="eyebrow">${primary ? 'ONE WALLET · TEST NETWORKS' : 'OLDER IMPORTED WALLET'}</div><h2>${primary ? chain === 'btc' ? 'Your Bitcoin test wallet.' : 'Your Solana devnet wallet.' : 'Your original BTC & SOL accounts.'}</h2></div>${keys && !primary ? '<button type="button" data-multi="lock" class="quiet">Lock imported wallet</button>' : ''}</div>
      <p>${chain === 'btc' ? 'Bitcoin Testnet3 only. Native BTC transfers only.' : 'Solana Devnet only. Native SOL and classic SPL token transfers.'} No mainnet, swaps or hardware signing.</p><p id="multi-notice" class="ledger-status" role="status" aria-live="polite">${escape(note)}</p>
      ${!keys ? primary ? `<section class="card"><h3>${loadingPrimary ? 'Opening your network accounts…' : 'Shared accounts unavailable for this import'}</h3><p>${loadingPrimary ? 'Deriving the first Bitcoin and Solana accounts from your unlocked recovery phrase.' : escape(note)}</p><p>Your Ethereum wallet remains available. No new phrase or vault has been created.</p></section>` : entry() : `${primary ? '' : `<div class="filter-tabs" aria-label="Choose test network"><button type="button" data-multi="btc" aria-pressed="${chain === 'btc'}" class="${chain === 'btc' ? 'is-active' : ''}">Bitcoin Testnet</button><button type="button" data-multi="sol" aria-pressed="${chain === 'sol'}" class="${chain === 'sol' ? 'is-active' : ''}">Solana Devnet</button></div>`}
      <div class="multichain-grid"><section class="card" data-multi-part="receive"><div class="eyebrow">${chain === 'btc' ? 'BITCOIN TESTNET3 · NOT MAINNET' : 'SOLANA DEVNET · NOT MAINNET'}</div><h3>Receive ${symbol()}</h3><p class="multi-balance">${hiddenBalance ? '••••••' : balance === undefined ? '—' : escape(amount(balance))} ${symbol()}</p><button type="button" data-multi="privacy" class="quiet">${hiddenBalance ? 'Show' : 'Hide'} balance</button><button type="button" data-multi="refresh" class="quiet">Refresh balance & submissions</button>${chain === 'btc' ? `<p>Confirmed balance only. Pending net change: ${hiddenBalance ? '••••••' : escape(amount(unconfirmed))} tBTC. Only confirmed outputs can be spent.</p>` : ''}<canvas id="multi-qr" aria-label="Public testnet receive address QR code"></canvas><code class="multi-address">${escape(owner())}</code><button type="button" data-multi="copy" class="quiet">Copy public address</button><p><a href="${multiExplorer(chain, 'address', owner())}" target="_blank" rel="noopener noreferrer">View address on testnet explorer ↗</a></p><p>Use this address only on the network shown above. A Solana address alone does not identify its network.</p><p class="hint">First account only: ${chain === 'btc' ? BTC_PATH : SOL_PATH}. No account discovery or change-address scanning. ${chain === 'btc' ? 'Bitcoin change returns to this same address.' : 'Native SOL transfers only.'}</p></section>
      <section class="card" data-multi-part="send"><h3>Send ${symbol()}</h3><form id="multi-send"><label for="multi-to">${chain === 'btc' ? 'Bitcoin Testnet recipient (tb1q)' : 'Solana Devnet recipient'}</label><input id="multi-to" required autocomplete="off" maxlength="90"><label for="multi-amount">Amount in ${symbol()}</label><input id="multi-amount" required inputmode="decimal" maxlength="40">${chain === 'btc' ? '<label for="multi-rate">Fee rate (sat/vB, 1–100)</label><input id="multi-rate" required type="number" min="1" max="100" step="1" value="2"><p class="hint">Manual fee rate. Confirmation time is not guaranteed.</p>' : ''}<button class="primary" type="submit">Review testnet transfer</button></form><div id="multi-review">${reviewMarkup()}</div></section></div>
      <section class="card" data-multi-part="backup"><h3>${primary ? 'One backup for all three networks' : 'Original imported-wallet backup'}</h3><p>${primary ? 'Your primary encrypted wallet backup preserves the recovery phrase for Ethereum, Bitcoin Testnet and Solana Devnet. Use the same local password; no second vault is required.' : 'This older wallet has its own phrase and password. Keep its original backup; its accounts cannot be merged into a different phrase without changing addresses.'}</p><button type="button" data-multi="backup" class="quiet">${primary ? 'Download wallet encrypted backup' : 'Download imported BTC & SOL backup'}</button><p>Auto-locks after 5 minutes idle or when hidden. Save the backup before adding test funds.</p></section>
      ${historyMarkup(rows)}`}`;
    if (keys) {
      const version = epoch;
      void QRCode.toCanvas(host.querySelector<HTMLCanvasElement>('#multi-qr')!, chain === 'btc' ? `bitcoin:${owner()}` : owner(), { width: 180, margin: 4 }).catch(() => { if (current(version)) message('QR unavailable. Use the full public address.'); });
    }
    if (keys && primary) {
      let contacts = [] as ReturnType<typeof parsePublicAccounts>;
      try { contacts=parsePublicAccounts(chain,JSON.parse(localStorage.getItem(publicAccountsKey(chain,'contacts',primary.wallet.address)) || '[]')); } catch { /* Invalid public cache. */ }
      const form=host.querySelector<HTMLFormElement>('#multi-send');
      if (form) {
        const label=document.createElement('label'); label.textContent='Saved recipient (optional)';
        const select=document.createElement('select'); select.innerHTML='<option value="">Enter manually</option>'+contacts.map(c=>`<option value="${escape(c.address)}">${escape(c.name)} · ${escape(c.address)}</option>`).join('');
        select.onchange=()=>{ field('multi-to').value=select.value; review=undefined; host.querySelector('#multi-review')?.replaceChildren(); };
        label.append(select); form.prepend(label);
      }
      const parts: Record<string, string[]> = { transfer: ['receive', 'send'], portfolio: ['receive'], activity: ['history'], overview: ['receive', 'send', 'backup', 'history'] };
      const visible = parts[primary.page || 'overview'] || parts.overview;
      host.querySelectorAll<HTMLElement>('[data-multi-part]').forEach(el => { el.hidden = !visible.includes(el.dataset.multiPart!); });
      const grid = host.querySelector<HTMLElement>('.multichain-grid'); if (grid) grid.hidden = primary.page === 'activity';
    }
    if (keys && primary) alignWalletLayout();
    const search=host.querySelector<HTMLInputElement>('#native-history-search'), status=host.querySelector<HTMLSelectElement>('#native-history-status');
    const updateHistory=()=>{host.querySelector('#native-history-results')!.innerHTML=historyResults(journal().filter(row=>row.owner===owner()&&row.chain===chain));};
    if(search) search.oninput=()=>{historyQuery=search.value;updateHistory();};
    if(status) status.onchange=()=>{historyStatus=status.value;updateHistory();};
    enhanceCards(host); controls();
  }
  function alignWalletLayout() {
    const receive=host.querySelector<HTMLElement>('[data-multi-part="receive"]')!;
    const send=host.querySelector<HTMLElement>('[data-multi-part="send"]')!;
    const backup=host.querySelector<HTMLElement>('[data-multi-part="backup"]')!;
    const grid=host.querySelector<HTMLElement>('.multichain-grid')!;
    // Reuse the same summary / transfer structure as the Ethereum workspace.
    host.classList.add('unified-network');
    const intro=host.querySelector('.section-heading'); intro?.remove();
    const description=host.querySelector(':scope > p'); if(description?.id!=='multi-notice') description?.remove();
    const summary=document.createElement('section'); summary.className='wallet-grid native-summary';
    summary.hidden=!['overview','portfolio'].includes(primary!.page || 'overview');
    const card=document.createElement('div'); card.className='balance-card';
    card.innerHTML=`<div class="eyebrow">AVAILABLE BALANCE <span>${chain==='btc'?'BITCOIN TESTNET3':'SOLANA DEVNET'}</span></div>`;
    const value=receive.querySelector<HTMLElement>('.multi-balance')!; value.className='balance'; card.append(value);
    const privacy=receive.querySelector<HTMLButtonElement>('[data-multi="privacy"]')!;
    const refresh=receive.querySelector<HTMLButtonElement>('[data-multi="refresh"]')!;
    const actions=document.createElement('div'); actions.className='balance-actions'; actions.append(privacy,refresh); card.append(actions);
    const address=document.createElement('div'); address.className='address-bar'; address.innerHTML=`<span>WALLET ADDRESS</span><code>${escape(owner().slice(0,9))}…${escape(owner().slice(-6))}</code><button type="button" data-multi="copy" aria-label="Copy wallet address">⧉</button>`; card.append(address);
    backup.classList.add('security'); backup.hidden=false;
    summary.append(card,backup); grid.before(summary);
    grid.prepend(send); grid.classList.add('wallet-grid','lower','native-transfer-grid');
    const qr=receive.querySelector('canvas'); if(qr) { const wrapper=document.createElement('div'); wrapper.className='receive'; qr.before(wrapper); wrapper.append(qr); }
    const addressCode=receive.querySelector('.multi-address');
    if(addressCode) {
      const network=document.createElement('strong'); network.className='receive-network'; network.textContent=chain==='btc'?'Bitcoin Testnet3 only':'Solana Devnet only'; addressCode.before(network);
      const save=document.createElement('button'); save.type='button'; save.className='quiet'; save.dataset.multi='save-qr'; save.textContent='Save receive QR image'; addressCode.after(save);
    }
    receive.querySelector('.eyebrow')?.remove();
    const heading=receive.querySelector('h3'); if(heading) heading.outerHTML='<div class="section-heading"><h2>Receive crypto</h2><span aria-hidden="true">↙</span></div>';
    const sendHeading=send.querySelector('h3'); if(sendHeading) sendHeading.outerHTML='<div class="section-heading"><h2>Send crypto</h2><span aria-hidden="true">↗</span></div>'; field('multi-to').placeholder=chain==='btc'?'tb1q…':'Solana wallet address'; field('multi-amount').placeholder='0.00'; const submit=send.querySelector('button[type="submit"]'); if(submit) submit.textContent='Review transfer →';
    const notes=receive.querySelectorAll(':scope > p'); if(notes.length) { const details=document.createElement('details'); details.className='receive-details'; details.innerHTML='<summary>Network & account details</summary>'; notes.forEach(p=>details.append(p)); receive.append(details); }
    const privacyNote=document.createElement('p'); privacyNote.className='hint'; privacyNote.textContent='Share your public address. Never share your password or backup.'; receive.querySelector('.receive-details')?.before(privacyNote);
    grid.hidden=!['overview','transfer'].includes(primary!.page || 'overview');
    receive.hidden=false; send.hidden=false;
    const history=host.querySelector<HTMLElement>('[data-multi-part="history"]'); history?.classList.add('activity');
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
    if(r.mint) return `<div class="review"><h3>Review SPL transfer · Solana Devnet</h3><p>Mint: <code class="multi-address">${escape(r.mint.mint)}</code></p><p>To wallet: <code class="multi-address">${escape(r.to)}</code></p><p>Amount: ${formatUnits(r.amount,r.mint.decimals)} SPL units<br>Network fee: ${formatUnits(r.fee,9)} devSOL</p><p>${r.mint.mintAuthority ? 'Mint authority remains enabled: supply may increase.' : 'Mint authority revoked.'} ${r.mint.freezeAuthority ? 'Freeze authority remains enabled: accounts may be frozen.' : 'Freeze authority revoked.'}</p><p>No token approval is granted. Review expires after 90 seconds.</p><label class="check"><input type="checkbox" id="multi-ack"> I checked the full mint, recipient and Devnet network.</label><button type="button" data-multi="sign" class="primary">Sign & send SPL test transfer</button><button type="button" data-multi="cancel" class="quiet">Cancel review</button></div>`;
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
    if (primary?.page === 'activity' || primary?.page === 'overview') {
      recent = []; recentNotice = 'Recent network activity unavailable. Check the address explorer.';
      try { const loaded = await readMultiActivity(selected, account); if (!current(version)) return; recent = loaded; recentNotice = 'Latest 20 network transactions. SPL amounts are net token balance changes; Bitcoin amounts are net address changes including fees.'; } catch { /* Keep balances and local submissions available independently. */ }
    }
    let unavailable = 0;
    for (const row of journal().filter(r => r.owner === account && r.chain === selected).slice(0, 20)) {
      try { const status = await submissionStatus(selected, row.id); if (!current(version)) return; record({ ...row, status }); }
      catch { unavailable++; }
    }
    if (current(version)) { note = unavailable ? 'Balance loaded. Some submission statuses are unavailable; verify on the explorer.' : 'Balance and available submission statuses refreshed.'; paint(); }
  }
  function unresolved() { return journal().some(row => row.owner === owner() && row.chain === chain && ['pending', 'unknown'].includes(row.status)); }
  async function prepare(to: string, text: string, rate: string, mintAddress?: string) {
    if (!keys) return;
    review = undefined;
    host.querySelector('#multi-review')?.replaceChildren();
    if (unresolved()) throw new Error('Resolve the pending or uncertain submission on this account before making another transfer. Refresh and check the explorer.');
    const version = epoch, selected = chain, account = owner();
    const mint=mintAddress ? await readMint(mintAddress) : undefined;
    if (!current(version)) return;
    const value = mint ? splUnits(text.trim(),mint.decimals) : units(text, decimals());
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
      if (mint) {
        const source=await readTokenAccount(account,mint), destination=await readTokenAccount(to.trim(),mint);
        if(!source.exists || source.amount<value) throw new Error('Insufficient SPL balance in your associated token account.');
        if(!destination.exists) throw new Error('Recipient associated token account does not exist for this mint. Ask the recipient to create it first.');
      }
      const tx = mint ? await splTransaction(account,to.trim(),mint,value,block.blockhash) : solTransfer(keys, to, value, block.blockhash);
      const quote = await solRpc('getFeeForMessage', [base64.encode(tx.serializeMessage()), { commitment: 'confirmed' }]);
      const fee = BigInt(safeNumber(quote?.value));
      if (fee > 1000000n) throw new Error('Solana fee exceeds the 0.001 SOL test-wallet limit.');
      const funds = await readMultiBalance('sol', keys);
      if ((mint ? fee : value + fee) > funds.confirmed) throw new Error('Not enough Devnet SOL for amount and network fee.');
      next = { chain: selected, owner: account, to: to.trim(), amount: value, fee, sol: tx, expiry, created: Date.now(), mint };
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
      if (r.mint) {
        const mint=await readMint(r.mint.mint); fresh();
        if(mint.decimals!==r.mint.decimals || mint.freezeAuthority!==r.mint.freezeAuthority || mint.mintAuthority!==r.mint.mintAuthority) throw new Error('Mint changed. Review again.');
        const source=await readTokenAccount(r.owner,mint), destination=await readTokenAccount(r.to,mint); fresh();
        if(!source.exists || source.amount<r.amount || !destination.exists) throw new Error('SPL accounts or balance changed. Review again.');
      }
      fresh(); signed = r.mint ? await signSpl(r.sol,k,r.to,r.mint,r.amount) : await signSol(r.sol, k, r.to, r.amount); fresh();
      await solSimulate(signed.raw as Uint8Array); fresh();
    } else throw new Error('Missing transaction review.');
    await assertTestnet(r.chain); fresh();
    const row: Submission = { chain: r.chain, owner: r.owner, id: signed.id, to: r.to, amount: String(r.amount), fee: String(r.fee), status: 'unknown', when: new Date().toISOString(), ...(r.mint ? {mint:r.mint.mint,decimals:r.mint.decimals} : {}) };
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
    if (!['multi-create', 'multi-unlock', 'multi-import', 'multi-phrase-import', 'multi-send','spl-import','spl-send'].includes(form.id)) return;
    event.preventDefault(); if (busy) return;
    const version = epoch;
    if(form.id==='spl-import') {
      const mint=field('spl-mint').value.trim();
      void run(async()=>{ const info=await readMint(mint); if(!current(version)) return; const rows=trackedMints(); if(rows.includes(info.mint)) throw new Error('Mint already tracked.'); if(rows.length>=25) throw new Error('Up to 25 mints supported.'); localStorage.setItem(splKey(owner('sol')),JSON.stringify([...rows,info.mint])); note='Devnet mint validated. Loading its balance. Mint addresses are not an endorsement.'; paint(); await refreshTokenBalances([info.mint]); });
    } else if(form.id==='spl-send') {
      const to=field('spl-to').value.trim(), value=field('spl-amount').value, mint=(host.querySelector('#spl-selected') as HTMLSelectElement).value;
      if(!trackedMints().includes(mint)) { message('Select a tracked mint.'); return; }
      void run(()=>prepare(to,value,'',mint));
    } else if (form.id === 'multi-create') {
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
    const tokenButton=event.target.closest<HTMLButtonElement>('[data-spl-refresh],[data-spl-remove]');
    if(tokenButton && !busy && keys && chain==='sol') {
      const mint=tokenButton.dataset.splRefresh || tokenButton.dataset.splRemove!;
      if(tokenButton.dataset.splRemove) {
        if(tokenButton.dataset.confirm!=='yes') { tokenButton.dataset.confirm='yes'; tokenButton.textContent='Confirm removal'; return; }
        try { localStorage.setItem(splKey(owner('sol')),JSON.stringify(trackedMints().filter(m=>m!==mint))); review=undefined; paint(); } catch { message('Could not remove mint.'); }
      } else { const version=epoch; void run(async()=>{ const info=await readMint(mint); const account=await readTokenAccount(owner('sol'),info); if(!current(version)) return; tokenBalances.set(mint,`${formatUnits(account.amount,info.decimals)} SPL units${account.exists?'':' · no associated account yet'}`); note=`Mint validated · ${info.decimals} decimals. ${info.freezeAuthority ? 'Freeze authority enabled.' : 'Freeze authority revoked.'}`; review=undefined; paint(); }); }
      return;
    }
    const action = event.target.closest<HTMLButtonElement>('button[data-multi]')?.dataset.multi;
    if (!action || disposed) return;
    if (action === 'refresh-tokens') { void refreshTokenBalances(); return; }
    if (action === 'lock') { lock(); return; }
    if (busy) return;
    if (action === 'btc' || action === 'sol') { epoch++; chain = action; primary?.select(action); review = undefined; balance = undefined; unconfirmed = 0n; note = 'Network selected. Refresh to load its balance.'; paint(); touch(); }
    if (action === 'privacy') { if (primary) primary.toggleBalance(); else hiddenBalance = !hiddenBalance; paint(); }
    if (action === 'cancel') { review = undefined; paint(); }
    if (action === 'refresh') void run(refresh);
    if (action === 'copy') void run(async () => { await navigator.clipboard.writeText(owner()); message('Public testnet address copied.'); });
    if (action === 'save-qr') void run(async () => {
      const canvas=host.querySelector<HTMLCanvasElement>('#multi-qr'); if(!canvas || !canvas.width) throw new Error('Receive QR is not ready.');
      const link=document.createElement('a'); link.href=canvas.toDataURL('image/png'); link.download=`forma-${chain}-testnet-receive.png`; link.click(); message('Public receive QR download requested.');
    });
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
  const edit = (event: Event) => { if ((event.target as Element).closest('#multi-send,#spl-send')) { review = undefined; host.querySelector('#multi-review')?.replaceChildren(); } };
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
        keys = derived; loadingPrimary = false; paint(); touch(); if(primary.page === 'tokens') void refreshTokenBalances(); else void run(refresh);
      } catch (error) {
        if (!disposed && version === epoch && primary.current()) { loadingPrimary = false; note = walletErrorMessage(error); paint(); }
      }
    })();
  }
  return () => { disposed = true; lock(); host.removeEventListener('submit', submit); host.removeEventListener('click', click); host.removeEventListener('input', edit); host.removeEventListener('pointerdown', touch); host.removeEventListener('keydown', touch); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', lock); window.removeEventListener('storage', storage); };
}

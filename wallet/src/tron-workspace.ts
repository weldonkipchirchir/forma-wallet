import { assetTable, assetLogo, readNativeReference } from './asset-display';
import { formatUnits, HDNodeWallet, Wallet } from 'ethers';
import QRCode from 'qrcode';
import { deriveTronAddress, parseTronTokens, tronAddress, tronDerivationPath, tronTokenKey as nileTokenKey, TRON_TEST_USDT, TRON_TOKEN_LIMIT } from './tron-core';
import { discoverTronContracts as nileDiscover, readTrc20Balance as nileTokenBalance, readTrc20Token as nileToken, readTronBalance as nileBalance, TRON_NILE_EXPLORER as NILE_EXPLORER } from './tron-network';
import { createTronMainnetReadApi, tronMainnetTokenKey, mainnetTronTokens, TRON_MAINNET_USDT } from './tron-mainnet';
import './tron.css';

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Session = { current(): boolean; hidden(): boolean; toggleHidden(): void; page: string; mainnet?: boolean };
export function mountTronWorkspace(host: HTMLElement, wallet: Wallet | HDNodeWallet, session: Session) {
  const mainnet=!!session.mainnet,label=mainnet?'TRON Mainnet':'TRON Nile',shortName=mainnet?'Mainnet':'Nile';
  const TRON_NILE_EXPLORER=mainnet?'https://tronscan.org':NILE_EXPLORER;
  const tronTokenKey=mainnet?tronMainnetTokenKey:nileTokenKey;
  const {readTronBalance,readTrc20Balance,readTrc20Token,discoverTronContracts}=mainnet?createTronMainnetReadApi():{readTronBalance:nileBalance,readTrc20Balance:nileTokenBalance,readTrc20Token:nileToken,discoverTronContracts:nileDiscover};
  let disposed = false, busy = false, page = 0, query = '', balance: bigint | undefined, activated: boolean | undefined;
  const priceAbort = new AbortController();
  let nativePrice: number | undefined;
  let usdtPrice:number|undefined;
  const values = new Map<string, bigint | undefined>();
  let owner: string;
  try { owner = deriveTronAddress(wallet); } catch (error) { host.textContent = (error as Error).message; return () => { disposed = true; host.replaceChildren(); }; }
  const live = () => !disposed && session.current() && host.isConnected;
  const guard = () => { if (!live()) throw new Error('Wallet or network changed.'); };
  const $ = (id: string) => host.querySelector<HTMLElement>(`#tron-${id}`)!;
  const tokens = () => { try { const raw = localStorage.getItem(tronTokenKey(owner)); return mainnet?mainnetTronTokens(raw):raw && raw.length <= 300000 ? parseTronTokens(JSON.parse(raw)) : []; } catch { return mainnet?mainnetTronTokens(null):[]; } };
  const field = (id: string) => ($(id) as HTMLInputElement).value;
  const quantity = (amount: bigint | undefined, decimals = 6) => session.hidden() ? '••••••' : amount === undefined ? 'Unavailable' : formatUnits(amount, decimals);
  function message(text: string, error = false) {
    if (!live()) return;
    const el = $('message'); el.textContent = text; el.setAttribute('role', error ? 'alert' : 'status'); el.classList.toggle('is-error', error);
    if (error) { el.tabIndex = -1; el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }
  function controls() {
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(element => { element.disabled = busy || element.hasAttribute('data-tron-unavailable'); });
    const count = matching().length;
    ($('previous') as HTMLButtonElement).disabled = busy || page === 0;
    ($('next') as HTMLButtonElement).disabled = busy || (page + 1) * 10 >= count;
  }
  async function run(work: () => Promise<void>) {
    if (!live() || busy) return;
    busy = true; controls();
    try { await work(); }
    catch (error) { message(error instanceof Error && !('code' in error) && error.message.length <= 250 ? error.message : `${label} request failed. Refresh or try again later.`, true); }
    finally { if (live()) { busy = false; controls(); } }
  }
  const matching = () => tokens().filter(token => [token.name, token.symbol, token.address].some(value => value.toLowerCase().includes(query.toLowerCase())));
  function holdings() {
    const el = host.querySelector<HTMLElement>('#tron-holdings');
    if (!el || !live()) return;
    const nativeAmount = balance === undefined ? undefined : formatUnits(balance, 6);
    el.innerHTML = assetTable([{ id: owner, symbol: 'TRX', name:label, amount: nativeAmount, usd: nativeAmount !== undefined && nativePrice !== undefined ? Number(nativeAmount) * nativePrice : undefined, verified: true }, ...tokens().map(token => {const known=mainnet&&token.address===TRON_MAINNET_USDT,amount=values.get(token.address)===undefined?undefined:formatUnits(values.get(token.address)!,token.decimals);return{id:token.address,symbol:token.symbol,name:`${token.name} · ${known?'issuer-listed':'unverified TRC-20'}`,amount,verified:known,kind:'token' as const,usd:known&&amount!==undefined&&usdtPrice!==undefined?Number(amount)*usdtPrice:undefined};})], session.hidden(),true,mainnet?'mainnet':'testnet');
  }
  function inventory() {
    if (!live()) return;
    holdings();
    const list = matching(); page = Math.min(page, Math.max(0, Math.ceil(list.length / 10) - 1));
    $('count').textContent = `${tokens().length} / ${TRON_TOKEN_LIMIT} tracked · ${list.length} matching · page ${page + 1} of ${Math.max(1, Math.ceil(list.length / 10))}`;
    $('token-list').innerHTML = list.slice(page * 10, page * 10 + 10).map(token => {
      const known=mainnet&&token.address===TRON_MAINNET_USDT;
      return `<div class="tron-token-row">${assetLogo(token.symbol,known)}<div><strong>${escape(token.symbol)}</strong><p>${escape(token.name)} · ${known?'issuer-listed':'unverified'}</p><code>${token.address}</code></div><strong>${values.has(token.address) ? quantity(values.get(token.address), token.decimals) : session.hidden() ? '••••••' : 'Not loaded'}</strong>${known?'<span class="pill">Included</span>':`<button type="button" class="quiet" data-tron-remove="${token.address}">Remove tracking</button>`}</div>`;
    }).join('') || `<p>No matching tracked tokens. Import a ${shortName} contract or discover candidate holdings.</p>`;
    $('token-list').querySelectorAll<HTMLButtonElement>('[data-tron-remove]').forEach(button => button.onclick = () => {
      if (!live() || busy) return;
      try { localStorage.setItem(tronTokenKey(owner), JSON.stringify(tokens().filter(token => token.address !== button.dataset.tronRemove))); inventory(); controls(); }
      catch { message('Token tracking could not be saved.', true); }
    });
    controls();
  }
  async function refreshTokens() {
    const visible = ['overview', 'portfolio'].includes(session.page) ? tokens() : matching().slice(page * 10, page * 10 + 10); let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, visible.length) }, async () => {
      while (index < visible.length && live()) {
        const token = visible[index++];
        try { const value = await readTrc20Balance(owner, token.address); guard(); values.set(token.address, value); }
        catch { if (!live()) return; values.set(token.address, undefined); }
        inventory();
      }
    }));
  }
  async function refresh() {
    const result = await readTronBalance(owner); guard(); balance = result.balance; activated = result.activated;
    $('balance').textContent = `${quantity(balance)} TRX`;
    $('activation').textContent = activated ? `Account activated on ${shortName}.` : `Account not activated on ${shortName}. ${mainnet?'Mainnet assets are real funds; sending remains unavailable.':'Use disposable test funds only.'}`;
    holdings();
    await refreshTokens(); guard(); message(`${shortName} identity checked; balances refreshed. This adapter cannot sign or send.`);
  }
  async function importContract(candidate = field('contract')) {
    const address = tronAddress(candidate), existing = tokens();
    if (existing.length >= TRON_TOKEN_LIMIT) throw new Error('Up to 100 tracked TRC-20 contracts per account.');
    if (existing.some(token => token.address === address)) throw new Error(`This ${shortName} contract is already tracked.`);
    const token = await readTrc20Token(owner, address); guard();
    localStorage.setItem(tronTokenKey(owner), JSON.stringify([...tokens(), token]));
    const amount = await readTrc20Balance(owner, address); guard(); values.set(address, amount); inventory();
    message(`TRC-20 metadata loaded from ${shortName}. The symbol is not proof of issuer authenticity.`);
  }
  async function discover() {
    const contracts = await discoverTronContracts(owner); guard();
    let added = 0, unavailable = 0;
    for (const address of contracts) {
      if (tokens().some(token => token.address === address) || tokens().length >= TRON_TOKEN_LIMIT) continue;
      try {
        const token = await readTrc20Token(owner, address), value = await readTrc20Balance(owner, address); guard();
        if (value <= 0n) continue;
        localStorage.setItem(tronTokenKey(owner), JSON.stringify([...tokens(), token])); values.set(address, value); added++;
      } catch { if (!live()) return; unavailable++; }
    }
    inventory(); message(`Added ${added} positive ${shortName} token balances from at most 10 indexer candidates.${unavailable ? ` ${unavailable} candidates were unavailable.` : ''} Coverage is incomplete; labels remain unverified.`);
  }
  host.innerHTML = `<p id="tron-message" class="hint" role="status">Opening ${label}…</p><section class="balance-card tron-summary"><div class="eyebrow">${mainnet?'TRON MAINNET · REAL FUNDS':'TRON NILE'} · READ-ONLY ADAPTER</div><h2 id="tron-balance">— TRX</h2><p id="tron-activation">Loading account status…</p><div class="balance-actions"><button id="tron-refresh" type="button" class="quiet">Refresh balances</button><button id="tron-privacy" type="button" class="quiet">${session.hidden() ? 'Show balances' : 'Hide balances'}</button></div></section>
    <section id="tron-holdings" class="card tron-holdings"></section><div class="wallet-grid tron-transfer-grid"><section class="card"><h2>Receive ${mainnet?'':'test '}TRX & TRC-20</h2><p><strong>${label} only</strong>. The T-address format is shared with Mainnet and does not identify the network.</p><canvas id="tron-qr" aria-label="${label} receiving address QR"></canvas><code class="multi-address">${owner}</code><button id="tron-copy" class="quiet" type="button">Copy ${shortName} address</button><p class="hint">Derivation: ${escape(tronDerivationPath(wallet as HDNodeWallet))}. Shared phrase-backed account index; imported Ethereum-only keys are excluded.</p><a href="${TRON_NILE_EXPLORER}/#/address/${owner}" target="_blank" rel="noopener noreferrer">Open ${shortName} explorer ↗</a></section><section class="card"><h2>TRON signing is not enabled</h2><p>Receive and inspect ${mainnet?'Mainnet':'testnet'} balances here. Sending, swaps, staking, approvals and card funding are unavailable through this adapter.</p><div class="tron-flow" aria-label="TRON read-only data flow"><span>Phrase-derived address</span><span aria-hidden="true">→</span><span>Pinned ${shortName} identity</span><span aria-hidden="true">→</span><span>Read-only balances</span></div><p class="hint">TRON uses protobuf transactions and Bandwidth/Energy resources. EVM type-2 signing is not compatible. No signing key is retained by this module.</p><button type="button" disabled data-tron-unavailable>Send unavailable</button></section></div>
    <section class="card tron-inventory"><div class="section-heading"><h2>TRC-20 tokens on ${shortName}</h2><button id="tron-discover" type="button" class="quiet">Discover held tokens</button></div><p>Discovery checks up to 10 positive indexer candidates against the actual contract. It can miss assets. Import a known ${shortName} contract to check it directly.</p><form id="tron-import"><label for="tron-contract">TRC-20 contract address</label><input id="tron-contract" required maxlength="42" autocomplete="off" placeholder="T… ${shortName} token contract"><button class="quiet">Import contract</button></form><button id="tron-test-usdt" class="quiet" type="button">Add official faucet’s test USDT contract</button><p class="hint">The faucet-listed token has no monetary value. It is not Mainnet USDT and is not a guaranteed dollar balance.</p><div class="tron-token-search"><label for="tron-query">Search tracked tokens<input id="tron-query" type="search" maxlength="80" autocomplete="off" placeholder="Name, symbol or address"></label><button id="tron-search" class="quiet" type="button">Search</button></div><p id="tron-count" class="hint" role="status"></p><div id="tron-token-list"></div><div class="tron-pagination"><button id="tron-previous" class="quiet" type="button">Previous</button><button id="tron-next" class="quiet" type="button">Next</button></div></section><section class="card tron-activity"><h2>TRON activity</h2><p>Full activity is available on the ${shortName} explorer. No local signed-transaction history is fabricated by this read-only adapter.</p><a href="${TRON_NILE_EXPLORER}/#/address/${owner}" target="_blank" rel="noopener noreferrer">View ${shortName} account activity ↗</a></section>`;
  $('refresh').onclick = () => { void run(refresh); };
  if(mainnet){$('test-usdt').hidden=true;const note=$('test-usdt').nextElementSibling;if(note)note.textContent='Official Mainnet USDT is included automatically. Receiving and tracking only; this adapter cannot sign or send.';}
  $('privacy').onclick = () => { session.toggleHidden(); $('balance').textContent = `${quantity(balance)} TRX`; $('privacy').textContent = session.hidden() ? 'Show balances' : 'Hide balances'; inventory(); };
  $('copy').onclick = () => { void run(async () => { await navigator.clipboard.writeText(owner); message(`${label} public address copied.`); }); };
  $('import').onsubmit = event => { event.preventDefault(); void run(() => importContract()); };
  $('test-usdt').onclick = () => { if(!mainnet)void run(() => importContract(TRON_TEST_USDT)); };
  $('discover').onclick = () => { void run(discover); };
  const search = () => { if (busy) return; query = field('query').trim().slice(0, 80); page = 0; inventory(); void run(refreshTokens); };
  $('search').onclick = search; $('query').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search(); } };
  $('previous').onclick = () => { if (busy) return; page = Math.max(0, page - 1); inventory(); void run(refreshTokens); };
  $('next').onclick = () => { if (busy) return; page++; inventory(); void run(refreshTokens); };
  host.querySelector<HTMLElement>('.tron-transfer-grid')!.hidden = session.page !== 'transfer';
  host.querySelector<HTMLElement>('.tron-summary')!.hidden = !['overview', 'portfolio'].includes(session.page);
  host.querySelector<HTMLElement>('.tron-inventory')!.hidden = session.page !== 'tokens';
  host.querySelector<HTMLElement>('.tron-activity')!.hidden = session.page !== 'activity';
  $('holdings').hidden = !['overview', 'portfolio'].includes(session.page);
  void readNativeReference('TRX', priceAbort.signal).then(price => { if (live()) { nativePrice = price; holdings(); } }).catch(() => {});
  if(mainnet)void readNativeReference('USDT',priceAbort.signal).then(price=>{if(live()){usdtPrice=price;holdings();}}).catch(()=>{});
  inventory(); void QRCode.toCanvas($('qr'), owner, { width: 180, margin: 2 }).catch(() => {}); void run(refresh);
  return () => { disposed = true; priceAbort.abort(); values.clear(); host.replaceChildren(); };
}

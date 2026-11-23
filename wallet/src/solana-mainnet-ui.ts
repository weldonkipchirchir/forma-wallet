import {loadSolHistory,type SolHistoryRow,type SolHistoryCursor} from './solana-history';
import { HDNodeWallet, Wallet, formatUnits } from 'ethers';
import { base64 } from '@scure/base';
import QRCode from 'qrcode';
import { deriveMulti, unifiedRoot, clearMulti, solRecipient, solTransfer, signSol, units, type MultiKeys } from './multichain-core';
import { splUnits, splTransaction, signSpl, type SplMint } from './sol-tokens';
import { safeNumber } from './multichain-network';
import { createMainnetApi, type SolanaMainnetConnection, MAINNET_USDT, listedSolanaMint, listedSolanaDisplayMint, mainnetMints, mainnetMintsKey, mainnetJournal, mainnetJournalKey, retainMainnetSubmission, type MainnetSubmission } from './solana-mainnet';
import { assetLogo, assetTable, readNativeReference, referenceDollars } from './asset-display';
import { enhanceCards } from './ui-panels';

const escape = (value: string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
type Review = { to: string; amount: bigint; mint?: SplMint; tx: ReturnType<typeof solTransfer>; expiry: number; fee: bigint; created: number };
export function mountSolanaMainnet(host: HTMLElement, wallet: Wallet | HDNodeWallet, session: {current():boolean; hidden():boolean; toggleHidden():void; page:string}) {
  const abort = new AbortController();
  let connection:SolanaMainnetConnection=localStorage.getItem('forma.sol.mainnet.rpc.v1')==='publicnode'?'publicnode':'solana';
  let api = createMainnetApi(abort.signal,connection,true);
  let disposed=false, busy=false, keys:MultiKeys|undefined, review:Review|undefined, balance:bigint|undefined;
  let solPrice:number|undefined, usdtPrice:number|undefined, usdcPrice:number|undefined;
  let discovered:string[]=[];let chainHistory:SolHistoryRow[]=[],historyCursor:SolHistoryCursor|undefined;let historyLoaded=false;
  const values=new Map<string,{mint:SplMint;amount:bigint}>();
  const live=()=>!disposed && session.current() && host.isConnected;
  const guard=()=>{if(!live() || !keys || keys.disposed) throw new Error('Wallet locked or account/network changed.');};
  const $=(id:string)=>host.querySelector<HTMLElement>(`#sm-${id}`)!;
  const field=(id:string)=>($(id) as HTMLInputElement).value;
  const owner=()=>keys!.solAddress;
  const storedMints=()=>mainnetMints(localStorage.getItem(mainnetMintsKey(owner())));
  const mints=()=>[...new Set([...storedMints(),...discovered])].slice(0,250);
  const journal=()=>mainnetJournal(localStorage.getItem(mainnetJournalKey(owner())));
  const record=(row:MainnetSubmission)=>localStorage.setItem(mainnetJournalKey(owner()),JSON.stringify(retainMainnetSubmission(journal(),row)));
  const unresolved=()=>journal().some(row=>['unknown','pending'].includes(row.status));
  function message(text:string,error=false) {if(!live())return; const el=$('message');el.textContent=text;el.className=error?'form-error':'hint';el.setAttribute('role',error?'alert':'status');if(error){el.tabIndex=-1;el.focus();}}
  function controls(){host.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select').forEach(el=>el.disabled=busy);}
  async function run(work:()=>Promise<void>){if(!live()||busy)return;busy=true;controls();try{await work();}catch(error){if(live())message(error instanceof Error && !('code' in error) && error.message.length<240?error.message:'Mainnet operation failed. Check network and transaction status before retrying.',true);}finally{if(live()){busy=false;controls();}}}
  function holdings(){
    if(!live()||!keys)return;
    const list=mints();
    $('native-balance').textContent=session.hidden()?'•••••• SOL':balance===undefined?'Balance unavailable':`${formatUnits(balance,9)} SOL`;
    $('native-usd').textContent=session.hidden()?'••••••':balance!==undefined&&solPrice!==undefined?referenceDollars(Number(formatUnits(balance,9))*solPrice):'USD estimate unavailable';
    $('holdings').innerHTML=assetTable([{id:'native',symbol:'SOL',name:'Solana',amount:balance===undefined?undefined:formatUnits(balance,9),usd:balance!==undefined&&solPrice!==undefined?Number(formatUnits(balance,9))*solPrice:undefined,verified:true},...list.map(id=>{
      const value=values.get(id),listed=listedSolanaMint(id),official=!!listed,amount=value?formatUnits(value.amount,value.mint.decimals):undefined;
      return {id,symbol:listed||'SPL',name:official?`${listed==='USDT'?'Tether USD':'USD Coin'} · issuer-listed mint`:`${id.slice(0,8)}…${id.slice(-6)} · unverified`,amount,usd:official&&amount!==undefined&&(listed==='USDT'?usdtPrice:usdcPrice)!==undefined?Number(amount)*(listed==='USDT'?usdtPrice!:usdcPrice!):undefined,verified:official,kind:'token' as const};
    })],session.hidden(),true,'mainnet','sol-mainnet');
    $('privacy').textContent=session.hidden()?'Show balances':'Hide balances';
  }
  function history(){
    const onchain=chainHistory.map(row=>`<div class="history-row chain-history-row">${assetLogo(row.symbol,row.mint?!!listedSolanaMint(row.mint):true,'sol-mainnet')}<div class="history-identity"><strong>${row.status==='failed'?'Failed transaction':row.direction==='received'?'Received':row.direction==='sent'?'Sent':row.direction==='self'?'Self transfer':'Transaction'} ${row.amount!==undefined?escape(row.symbol):''}</strong><p>${row.when?escape(new Date(row.when).toLocaleString()):'Time unavailable'}${row.kind==='balance-change'?' · Net balance change':''}</p>${row.peer?`<code>${escape(row.peer)}</code>`:''}<a href="https://explorer.solana.com/tx/${row.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a></div><div class="history-value"><strong>${session.hidden()?'••••••':row.amount===undefined?'Amount unavailable':`${row.direction==='received'?'+':row.direction==='sent'?'-':''}${formatUnits(row.amount,row.decimals)} ${escape(row.symbol)}`}</strong><span class="status-chip">${row.status}</span></div></div>`).join('');
    const local=journal().map(row=>`<div class="history-row"><div class="history-identity"><strong>Sent ${row.mint?(listedSolanaMint(row.mint)||'SPL'):'SOL'} · ${row.status}</strong><p>${escape(new Date(row.when).toLocaleString())}</p><code>${escape(row.to)}</code><a href="https://explorer.solana.com/tx/${row.id}" target="_blank" rel="noopener noreferrer">Check Mainnet transaction ↗</a></div><div class="history-value">${session.hidden()?'••••••':escape(formatUnits(row.amount,row.decimals))}</div></div>`).join('')||'<p>No transfers submitted from this browser.</p>';
    $('history').innerHTML=(onchain||`<p class="empty">${historyLoaded?'No supported activity found in this page.':'Load activity to see incoming and outgoing transfers.'}</p>`)+`<details class="local-history"><summary>Locally submitted transactions</summary>${local}</details>`;
    const more=host.querySelector<HTMLButtonElement>('#sm-history-more');if(more)more.hidden=!historyCursor;
  }
  async function refreshHistory(older=false){guard();const page=await loadSolHistory(api,owner(),live,older?historyCursor:undefined);guard();const merged=older?[...chainHistory,...page.rows]:page.rows;chainHistory=[...new Map(merged.map(row=>[row.id,row])).values()].slice(0,200);historyCursor=chainHistory.length<200?page.cursor:undefined;historyLoaded=true;history();}
  async function refresh(){
    guard();balance=undefined;values.clear();holdings();await api.identity();guard();balance=await api.balance(owner());guard();holdings();
    if(session.page!=='activity'){try{discovered=await api.discover(owner());guard();}catch{guard();}
    const list=mints(),deadline=Date.now()+30000;let next=0;
    await Promise.all(Array.from({length:Math.min(3,list.length)},async()=>{while(next<list.length&&live()&&Date.now()<deadline){const id=list[next++];values.delete(id);try{const mint=listedSolanaDisplayMint(id)||await api.mint(id),amount=await api.heldBalance(owner(),mint);guard();values.set(id,{mint,amount});}catch{guard();}holdings();}}));
    }
    for(const row of journal().filter(row=>['unknown','pending'].includes(row.status))){
      const result=await api.rpc('getSignatureStatuses',[[row.id],{searchTransactionHistory:true}]);guard();const status=result?.value?.[0];
      if(status?.err!=null)record({...row,status:'failed'});else if(['confirmed','finalized'].includes(status?.confirmationStatus))record({...row,status:'confirmed'});
    }
    history();if(session.page==='activity'){await refreshHistory();message('Recent on-chain activity loaded. Load earlier activity for more.');}else message('Balances updated.');
  }
  async function prepare(){
    guard();review=undefined;$('review').replaceChildren();if(unresolved())throw new Error('Resolve the pending or unknown Mainnet transaction before sending again.');
    const to=solRecipient(field('to').trim()).toBase58();if(to===owner())throw new Error('Choose a different recipient.');
    const id=field('asset');if(id!=='native'&&!mints().includes(id))throw new Error('Choose a tracked mint.');
    await api.identity();guard();const mint=id==='native'?undefined:await api.mint(id);guard();
    const amount=mint?splUnits(field('amount').trim(),mint.decimals):units(field('amount').trim(),9);
    if(mint){const source=await api.account(owner(),mint),destination=await api.account(to,mint);guard();if(!source.exists||source.amount<amount)throw new Error('Insufficient token balance.');if(!destination.exists)throw new Error('Recipient token account does not exist. This version requires an existing associated token account.');}
    const block=(await api.rpc('getLatestBlockhash',[{commitment:'confirmed'}]))?.value;guard();
    const expiry=safeNumber(block?.lastValidBlockHeight);
    const tx=mint?await splTransaction(owner(),to,mint,amount,block.blockhash):solTransfer(keys!,to,amount,block.blockhash);guard();
    const fee=BigInt(safeNumber((await api.rpc('getFeeForMessage',[base64.encode(tx.serializeMessage()),{commitment:'confirmed'}]))?.value));guard();
    if(fee>1000000n)throw new Error('Fee exceeds the 0.001 SOL safety limit.');
    if(await api.balance(owner())<(mint?fee:amount+fee))throw new Error('Insufficient SOL for amount and network fee.');guard();
    review={to,amount,mint,tx,expiry,fee,created:Date.now()};
    $('review').innerHTML=`<div class="review"><strong>REAL FUNDS · Solana Mainnet</strong><p>Send ${escape(formatUnits(amount,mint?.decimals??9))} ${mint?(listedSolanaMint(mint.mint)||'SPL'):'SOL'}</p><p>Full recipient: <code>${escape(to)}</code></p>${mint?`<p>Mint: <code>${mint.mint}</code></p>`:''}<p>Network fee: ${formatUnits(fee,9)} SOL. Review expires in 90 seconds.</p><label class="check"><input id="sm-ack" type="checkbox"> I checked the full recipient, mint, amount and Mainnet. This transfer spends real funds.</label><button id="sm-confirm" class="primary" type="button">Confirm Mainnet transfer</button><button id="sm-cancel" class="quiet" type="button">Cancel</button></div>`;
    $('confirm').onclick=()=>void run(send);$('cancel').onclick=()=>{review=undefined;$('review').replaceChildren();};
  }
  async function send(){
    guard();if(!review||!($('ack') as HTMLInputElement).checked)throw new Error('Acknowledge the Mainnet transfer review.');
    const r=review,k=keys!;review=undefined;$('review').replaceChildren();
    if(!navigator.locks)throw new Error('Mainnet sending requires browser Web Locks support.');
    await navigator.locks.request(`forma.sol.mainnet.send:${owner()}`,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Another tab is sending from this Mainnet account.');
      const fresh=()=>{guard();if(Date.now()-r.created>90000)throw new Error('Mainnet review expired. Review again.');};fresh();
      if(unresolved())throw new Error('A pending or unknown transaction blocks this transfer.');
      await api.identity();fresh();if(safeNumber(await api.rpc('getBlockHeight',[{commitment:'confirmed'}]))>r.expiry)throw new Error('Blockhash expired. Review again.');fresh();
      if(r.mint){const mint=await api.mint(r.mint.mint);fresh();if(JSON.stringify(mint)!==JSON.stringify(r.mint))throw new Error('Mint changed. Review again.');const source=await api.account(owner(),mint),destination=await api.account(r.to,mint);fresh();if(!source.exists||source.amount<r.amount||!destination.exists)throw new Error('Token balance or accounts changed.');}
      const fee=BigInt(safeNumber((await api.rpc('getFeeForMessage',[base64.encode(r.tx.serializeMessage()),{commitment:'confirmed'}]))?.value));fresh();
      if(fee!==r.fee||await api.balance(owner())<(r.mint?fee:r.amount+fee))throw new Error('Fee or SOL balance changed. Review again.');fresh();
      const signed=r.mint?await signSpl(r.tx,k,r.to,r.mint,r.amount):await signSol(r.tx,k,r.to,r.amount);fresh();
      const simulation=await api.rpc('simulateTransaction',[base64.encode(signed.raw),{encoding:'base64',sigVerify:true,commitment:'confirmed'}]);fresh();
      if(simulation?.value?.err!==null)throw new Error('Mainnet simulation failed. Nothing was broadcast.');
      await api.identity();fresh();if(safeNumber(await api.rpc('getBlockHeight',[{commitment:'confirmed'}]))>r.expiry)throw new Error('Blockhash expired before broadcast.');fresh();
      const row:MainnetSubmission={id:signed.id,to:r.to,amount:r.amount.toString(),decimals:r.mint?.decimals??9,mint:r.mint?.mint,expiry:r.expiry,when:Date.now(),status:'unknown'};
      record(row);fresh(); // Durable record must succeed before the single broadcast attempt.
      const result=await api.rpc('sendTransaction',[base64.encode(signed.raw),{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);fresh();
      if(result!==signed.id)throw new Error('Broadcast response differs. Check the recorded signature before retrying.');
      record({...row,status:'pending'});history();message('Mainnet transfer submitted. Wait for confirmation; never retry an unknown submission automatically.');
    });
  }
  function paint(){
    host.innerHTML=`<p id="sm-message" class="hint" role="status">Solana Mainnet · real funds</p><section class="balance-card sol-account-card"><div class="eyebrow">YOUR SOLANA ACCOUNT</div><h2 id="sm-native-balance">Your balance</h2><p class="native-usd" id="sm-native-usd"></p><code class="multi-address">${owner()}</code><div class="balance-actions"><button id="sm-refresh" type="button" class="quiet">Refresh balances & status</button><button id="sm-privacy" type="button" class="quiet">Hide balances</button></div><details class="connection-options"><summary>Account details</summary><p>Derivation: m/44'/501'/0'/0'. Compare this address with the withdrawal destination. Mainnet and Devnet balances are separate. Other wallets may use a different derivation path.</p></details><button id="sm-find-received" type="button" class="quiet">Find received tokens</button><details class="connection-options"><summary>Connection options</summary><label for="sm-connection">RPC connection</label><select id="sm-connection"><option value="solana" ${connection==='solana'?'selected':''}>Solana public RPC</option><option value="publicnode" ${connection==='publicnode'?'selected':''}>PublicNode public RPC</option></select><p class="hint">If balances are unavailable, try the other reviewed provider. Addresses and signed transactions go to the selected provider. No automatic broadcast retries.</p></details></section>
      <section id="sm-holdings" class="card holdings-shell"></section>
      <div class="native-transfer-grid wallet-grid lower" id="sm-transfer"><section class="card"><h2>Send crypto</h2><form id="sm-send"><label for="sm-asset">Asset</label><select id="sm-asset"><option value="native">SOL · network fees</option>${mints().map(id=>`<option value="${id}">${listedSolanaMint(id)?`${listedSolanaMint(id)} · issuer-listed mint`:`SPL · ${id.slice(0,8)}…${id.slice(-6)}`}</option>`).join('')}</select><label for="sm-to">Recipient Solana wallet</label><input id="sm-to" required maxlength="44" autocomplete="off"><label for="sm-amount">Amount</label><input id="sm-amount" required inputmode="decimal" maxlength="40" autocomplete="off"><p class="hint">Real funds. SOL pays fees. Tokens require the recipient’s existing associated token account; automatic account creation and Token-2022 are unavailable.</p><button class="primary">Review Mainnet transfer</button></form><div id="sm-review"></div></section><section class="card"><h2>Receive crypto</h2><p>Solana Mainnet only. Share this wallet address, never the token mint.</p><canvas id="sm-qr" aria-label="Solana Mainnet receiving address"></canvas><code class="multi-address">${owner()}</code><button id="sm-copy" type="button" class="quiet">Copy address</button><a href="https://explorer.solana.com/address/${owner()}" target="_blank" rel="noopener noreferrer">View Mainnet account ↗</a></section></div>
      <section id="sm-tokens" class="card holdings-shell"><h2>Your tokens</h2><p>USDT and USDC are included automatically. We also find classic tokens held by this address. You can save up to 25 custom mints; discovery displays up to 250. Token-2022 is not supported. Sending uses the associated token account only.</p><p><code>${MAINNET_USDT}</code> · <a href="https://tether.to/en/supported-protocols/" target="_blank" rel="noopener noreferrer">Tether issuer reference ↗</a></p><form id="sm-import"><label for="sm-mint">Token mint</label><input id="sm-mint" required maxlength="44" autocomplete="off"><button class="quiet">Validate & add mint</button></form><button id="sm-discover" type="button" class="quiet">Find held tokens</button></section>
      <section id="sm-activity" class="card holdings-shell"><div class="section-heading"><div><div class="eyebrow">ON-CHAIN HISTORY</div><h2>Sent & received</h2></div><button id="sm-history-refresh" type="button" class="quiet">Refresh activity</button></div><p>Recent SOL transfers and token balance changes for this address, including deposits from other wallets. Complex program activity may show a net change or an unavailable amount.</p><div id="sm-history"></div><button id="sm-history-more" type="button" class="quiet" hidden>Load earlier activity</button><p class="hint">Up to 200 records per session, with the wallet address and up to five classic token accounts. Older or additional token accounts may require the explorer. <a href="https://explorer.solana.com/address/${owner()}" target="_blank" rel="noopener noreferrer">View full account activity ↗</a></p></section>`;
    host.querySelector<HTMLElement>('.sol-account-card')!.hidden=session.page==='activity';
    $('holdings').hidden=!['overview','portfolio','tokens'].includes(session.page);$('transfer').hidden=session.page!=='transfer';$('tokens').hidden=session.page!=='tokens';$('activity').hidden=!['overview','activity'].includes(session.page);
    $('history-refresh').onclick=()=>void run(()=>refreshHistory());$('history-more').onclick=()=>void run(()=>refreshHistory(true));
    $('connection').onchange=()=>{if(busy)return;const choice=field('connection');if(choice!=='solana'&&choice!=='publicnode')return;void run(async()=>{localStorage.setItem('forma.sol.mainnet.rpc.v1',choice);connection=choice;review=undefined;balance=undefined;values.clear();api=createMainnetApi(abort.signal,connection,true);paint();await refresh();});};
    $('refresh').onclick=()=>void run(refresh);$('privacy').onclick=()=>{session.toggleHidden();holdings();history();};
    $('send').onsubmit=event=>{event.preventDefault();void run(prepare);};$('send').oninput=()=>{review=undefined;$('review').replaceChildren();};$('send').onchange=()=>{review=undefined;$('review').replaceChildren();};
    $('copy').onclick=()=>void run(async()=>{await navigator.clipboard.writeText(owner());message('Mainnet wallet address copied.');});
    $('import').onsubmit=event=>{event.preventDefault();void run(async()=>{await api.identity();guard();const mint=await api.mint(field('mint').trim());guard();const tracked=storedMints();if(tracked.includes(mint.mint))throw new Error('Mint is already saved or included automatically.');const custom=tracked.filter(id=>!listedSolanaMint(id));if(custom.length>=25)throw new Error('25 saved custom-mint limit reached. Discovered holdings are still displayed.');localStorage.setItem(mainnetMintsKey(owner()),JSON.stringify([...custom,mint.mint]));paint();await refresh();});};
    $('discover').onclick=()=>void run(async()=>{await refresh();guard();paint();message('Held tokens refreshed. Discovery does not save new mints or request approvals.');});
    $('find-received').onclick=$('discover').onclick;
    enhanceCards(host);holdings();history();controls();void QRCode.toCanvas($('qr'),owner(),{width:180,margin:2}).catch(()=>{});
  }
  const changed=(event:StorageEvent)=>{if(keys&&[mainnetMintsKey(owner()),mainnetJournalKey(owner()),null].includes(event.key)){review=undefined;if(live()){ $('review').replaceChildren();message('Another tab changed this Mainnet account. Refresh before sending.');}}};
  window.addEventListener('storage',changed);
  host.textContent='Opening Solana Mainnet…';
  void Promise.resolve().then(()=>deriveMulti(unifiedRoot(wallet))).then(derived=>{if(!live()){clearMulti(derived);return;}keys=derived;paint();void run(refresh);for(const symbol of ['SOL','USDT','USDC'])void readNativeReference(symbol,abort.signal).then(price=>{if(live()){if(symbol==='SOL')solPrice=price;else if(symbol==='USDT')usdtPrice=price;else usdcPrice=price;holdings();}}).catch(()=>{});}).catch(()=>{clearMulti(keys);keys=undefined;if(live())host.textContent='Could not open Solana Mainnet. A phrase-backed wallet without a BIP-39 passphrase and valid browser storage are required. Existing backups are preserved.';});
  return()=>{disposed=true;review=undefined;abort.abort();clearMulti(keys);keys=undefined;window.removeEventListener('storage',changed);host.replaceChildren();};
}

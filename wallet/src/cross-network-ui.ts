import {allocationChart} from './portfolio-allocation';
import type {Wallet,HDNodeWallet} from 'ethers';
import {assetTable,readNativeReference,referenceDollars} from './asset-display';
import {environmentNetworks,scanNetworks,createCrossNetworkReader,type NetworkHolding} from './cross-network-data';
import {networkLogo,networkIconPath} from './network-identity';
import {networkLabel} from './network-environment';
import {type NetworkId} from './network-context';
import {portfolioCache as cache} from './portfolio-cache';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function portfolioRows(rows:NetworkHolding[],query:string,chain:string,hideZero:boolean){const text=query.trim().toLowerCase().slice(0,100);return rows.filter(row=>(chain==='all'||row.network===chain)&&(!hideZero||row.amount===undefined||!/^0(?:\.0+)?$/.test(row.amount))&&[row.symbol,row.name,row.id,networkLabel(row.network)].some(value=>value.toLowerCase().includes(text)));}
export function mountCrossNetworkOverview(host:HTMLElement,wallet:Wallet|HDNodeWallet,live:boolean,session:{selected:NetworkId;current():boolean;hidden():boolean;toggleHidden():void;choose(id:NetworkId):void}){
  const connection=localStorage.getItem('forma.sol.mainnet.rpc.v1')||'solana';
  let disposed=false,running=false,pricesBusy=false,epoch=0,page=0,query='',chain='all',hideZero=true,checked=0,when=0,prices:Record<string,number>={};
  try{if(localStorage.getItem('forma.overview.scope')==='selected')chain=session.selected;}catch{/* Scope is optional. */}
  const networks=environmentNetworks(live),results=new Map<NetworkId,NetworkHolding[]>(),failed=new Set<NetworkId>(),abort=new AbortController();
  const current=()=>!disposed&&session.current()&&host.isConnected;
  const $=(id:string)=>host.querySelector<HTMLElement>(`#all-${id}`)!;
  const all=()=>networks.flatMap(id=>results.get(id)||[]);
  let paintQueued=false;const schedule=()=>{if(paintQueued||!current())return;paintQueued=true;queueMicrotask(()=>{paintQueued=false;if(current())paint();});};
  const reader=createCrossNetworkReader(wallet,localStorage,abort.signal,current,(id,rows)=>{if(current()){results.set(id,[...rows]);schedule();}});
  host.innerHTML=`<section class="portfolio-hero"><div><div class="eyebrow">YOUR WALLET · ${live?'LIVE ASSETS':'TEST ASSETS'}</div><h2 id="all-heading">Your assets.</h2><div class="portfolio-scope" role="group" aria-label="Portfolio scope"><button type="button" id="all-scope-all" aria-pressed="true">All networks</button><button type="button" id="all-scope-selected" aria-pressed="false">${networkLogo(session.selected)} ${escape(networkLabel(session.selected))} only</button></div><p>One view across ${networks.length} supported networks in this environment.</p></div><div class="portfolio-hero-total"><strong id="all-total">Loading balances…</strong><span id="all-coverage"></span></div><div class="portfolio-hero-actions"><button id="all-refresh" class="primary" type="button">Refresh all networks</button><button id="all-prices" class="quiet" type="button">Refresh prices</button><button id="all-privacy" class="quiet" type="button">Hide balances</button></div></section><section class="card allocation-card"><div class="section-heading"><div><div class="eyebrow">PORTFOLIO MIX</div><h2>Where your assets are</h2></div><span class="pill">Current allocation</span></div><p>Share of the value we can price. Unavailable balances and unpriced tokens are excluded.</p><div id="all-allocation"></div></section><section class="card cross-assets"><div class="section-heading"><div><div class="eyebrow">MULTICHAIN PORTFOLIO</div><h2>Assets, together.</h2></div><span id="all-progress" class="pill" role="status"></span></div><div class="cross-toolbar"><label>Search all assets<input id="all-query" type="search" maxlength="100" autocomplete="off" placeholder="Asset, contract or network"></label><label>Network<select id="all-chain"><option value="all">All networks</option>${networks.map(id=>`<option data-network-icon="${networkIconPath(id)}" value="${id}">${escape(networkLabel(id))}</option>`).join('')}</select></label><label class="check"><input id="all-zero" type="checkbox" checked> Hide zero balances</label></div><p id="all-updated" class="hint"></p><div id="all-table"></div><div class="cross-pagination"><button id="all-prev" class="quiet" type="button">Previous</button><span id="all-page"></span><button id="all-next" class="quiet" type="button">Next</button></div><details class="portfolio-coverage"><summary>Coverage, prices and unavailable balances</summary><p>Current unlocked account only. Includes native assets, tracked tokens, issuer-listed presets and up to 250 discovered classic Solana mints. Discovery can be incomplete or unavailable. New or untracked tokens may require discovery/import on their network. Token-2022, unsupported chains and other derivation paths are not included. Failed reads are unavailable, never zero. USD totals include priced assets only; unknown tokens are not priced by name.${live?'':' Test assets have no monetary value; USD values are hypothetical.'}</p><p>Public addresses are queried at the reviewed RPC endpoints. At most two networks are scanned at once, with bounded per-request time/size and a per-network time budget. A slow provider may leave some token balances unavailable.</p></details></section>`;
  function paint(){
    const rows=all().map(row=>({...row,name:row.kind?`${row.name} · ${networkLabel(row.network)}`:networkLabel(row.network),usd:row.amount!==undefined&&row.priceSymbol&&prices[row.priceSymbol]!==undefined?Number(row.amount)*prices[row.priceSymbol]:undefined}));
    const scoped=rows.filter(row=>chain==='all'||row.network===chain);
    const priced=scoped.filter(row=>row.usd!==undefined&&Number.isFinite(row.usd)),total=priced.reduce((sum,row)=>sum+row.usd!,0),hidden=session.hidden();
    $('total').textContent=hidden?'••••••':priced.length?referenceDollars(total):running?'Loading balances…':pricesBusy?'Updating prices…':'Price temporarily unavailable';
    $('heading').textContent=chain==='all'?'Your assets.':`${networkLabel(chain as NetworkId)} assets.`;
    $('scope-all').setAttribute('aria-pressed',String(chain==='all'));$('scope-selected').setAttribute('aria-pressed',String(chain===session.selected));
    const chainSelect=$('chain') as HTMLSelectElement;if(chainSelect.value!==chain){chainSelect.value=chain;chainSelect.dispatchEvent(new Event('change',{bubbles:true}));}
    $('total').classList.toggle('price-unavailable',!priced.length&&!hidden&&!running);
    const chart=$('allocation').closest<HTMLElement>('.allocation-card');if(chart)chart.hidden=!priced.length||hidden;
    ($('prices') as HTMLButtonElement).disabled=pricesBusy||running;
    $('coverage').textContent=`${live?'Estimated':'Hypothetical'} priced subtotal · ${priced.length}/${scoped.length} assets priced`;
    $('progress').textContent=`${checked}/${networks.length} networks checked${failed.size?` · ${failed.size} networks unavailable`:''}${rows.some(row=>row.amount===undefined)?` · ${rows.filter(row=>row.amount===undefined).length} balances unavailable`:''}`;
    $('updated').textContent=running?'Updating balances across networks…':when?`Last scan: ${new Date(when).toLocaleString()}. Refresh after a deposit. ${failed.size?'Some networks could not be read.':''}`:'Ready to scan.';
    const matched=portfolioRows(rows,query,chain,hidden?false:hideZero);page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(matched.length/25)-1)));const visible=matched.slice(page*25,page*25+25);
    $('allocation').innerHTML=allocationChart(scoped,hidden);
    $('table').innerHTML=assetTable(visible,hidden,false,live?'mainnet':'testnet');
    $('table').querySelectorAll<HTMLElement>('[data-holding-row]').forEach((element,i)=>{const row=visible[i],button=document.createElement('button');button.type='button';button.className='text-button asset-network-link';button.textContent=`Open ${networkLabel(row.network)} ↗`;button.onclick=()=>{if(current())session.choose(row.network);};element.append(button);});
    ($('prev') as HTMLButtonElement).disabled=page===0;($('next') as HTMLButtonElement).disabled=(page+1)*25>=matched.length;
    $('page').textContent=`${matched.length} assets · ${page+1}/${Math.max(1,Math.ceil(matched.length/25))}`;
    ($('refresh') as HTMLButtonElement).disabled=running||pricesBusy;$('privacy').textContent=hidden?'Show balances':'Hide balances';($('zero') as HTMLInputElement).disabled=hidden;
  }
  async function updatePrices(version=epoch){if(pricesBusy||!current())return;pricesBusy=true;prices={};paint();
    const quotes=['ETH','BTC','SOL','TRX','POL','AVAX','BNB','USDT','USDC'];let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<quotes.length&&current()&&epoch===version){const symbol=quotes[next++];try{const price=await readNativeReference(symbol,abort.signal);if(current()&&epoch===version){prices[symbol]=price;schedule();}}catch{/* Missing prices remain unavailable. */}}}));
    if(current()&&epoch===version){pricesBusy=false;const saved=cache.get(wallet)?.get(live);if(saved)saved.prices={...prices};paint();}
  }
  async function scan(){if(running||pricesBusy||!current())return;running=true;checked=0;failed.clear();results.clear();prices={};const version=++epoch;paint();
    const pricing=updatePrices(version);
    await scanNetworks(networks,reader.read,()=>current()&&epoch===version,(id,rows,bad)=>{results.set(id,rows);if(bad)failed.add(id);checked++;schedule();});await pricing;
    if(!current()||epoch!==version)return;running=false;when=Date.now();let entries=cache.get(wallet);if(!entries){entries=new Map();cache.set(wallet,entries);}entries.set(live,{connection,rows:all(),failed:[...failed],when,prices:{...prices}});paint();
  }
  const setScope=(value:string)=>{chain=value;page=0;try{localStorage.setItem('forma.overview.scope',chain==='all'?'all':'selected');}catch{/* Optional preference. */}paint();};
  $('scope-all').onclick=()=>setScope('all');$('scope-selected').onclick=()=>setScope(session.selected);
  $('prices').onclick=()=>{void updatePrices();};
  $('refresh').onclick=()=>{void scan();};$('privacy').onclick=()=>{session.toggleHidden();paint();};$('query').oninput=()=>{query=($('query') as HTMLInputElement).value;page=0;paint();};$('chain').onchange=()=>{const value=($('chain') as HTMLSelectElement).value;if(value!==chain)setScope(value);};$('zero').onchange=()=>{hideZero=($('zero') as HTMLInputElement).checked;page=0;paint();};$('prev').onclick=()=>{page--;paint();};$('next').onclick=()=>{page++;paint();};
  const saved=cache.get(wallet)?.get(live);if(saved&&saved.connection===connection&&saved.failed.length===0&&Date.now()-saved.when<60000){for(const row of saved.rows){const rows=results.get(row.network)||[];rows.push(row);results.set(row.network,rows);}saved.failed.forEach(id=>failed.add(id));checked=networks.length;when=saved.when;prices={...saved.prices};paint();}else void scan();
  return()=>{disposed=true;epoch++;abort.abort();reader.dispose();host.replaceChildren();};
}

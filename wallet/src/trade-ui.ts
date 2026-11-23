import {type Wallet,type HDNodeWallet} from 'ethers';
import {mountStableSwap} from './stable-swap-ui';
import {assetLogo} from './asset-display';
import {networkLabel} from './network-environment';
import {isMainnetNetwork,type NetworkId} from './network-context';
import {deriveMulti,unifiedRoot,clearMulti} from './multichain-core';
import {deriveTronAddress} from './tron-core';
import {BUY_USDT_URL} from './trade-options';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
export function mountTrade(host:HTMLElement,wallet:Wallet|HDNodeWallet,network:NetworkId,mode:'swap'|'buy',session:{current():boolean;choose(network:NetworkId):void}){
  const abort=new AbortController();let disposed=false;
  const current=()=>!disposed&&session.current()&&host.isConnected;
  const $=(id:string)=>host.querySelector<HTMLElement>(`#trade-${id}`)!;
  
  const chooseMarkup=()=>`<div class="trade-network-choices">${(['sol-mainnet','ethereum-mainnet','avalanche-mainnet'] as NetworkId[]).map(id=>`<button type="button" class="quiet" data-trade-network="${id}">${escape(networkLabel(id))}</button>`).join('')}</div>`;
  const bindChoices=()=>host.querySelectorAll<HTMLButtonElement>('[data-trade-network]').forEach(button=>button.onclick=()=>{if(current())session.choose(button.dataset.tradeNetwork as NetworkId);});
  if(!isMainnetNetwork(network)){host.innerHTML=`<section class="card trade-empty"><h2>${mode==='buy'?'Buy USDT':'Swap tokens'}</h2><p>Purchases and exchange services use live assets. Select Mainnet above to continue. Test tokens cannot be bought or redeemed.</p><ol class="flow-diagram"><li>Choose a network</li><li>Choose your assets</li><li>Review with the provider</li></ol></section>`;return()=>{disposed=true;abort.abort();};}
  if(mode==='swap'){
    if(network==='ethereum-mainnet')return mountStableSwap(host,wallet,session);
    host.innerHTML=`<section class="card trade-empty"><span class="pill">Direct swap adapter</span><h2>Direct swaps on ${escape(networkLabel(network))} are not enabled yet</h2><p>The first reviewed adapter supports USDT and USDC on Ethereum. Solana and other chains need their own transaction validation before Forma can sign swaps safely.</p><button id="trade-direct-network" type="button" class="primary">Switch to Ethereum swaps</button><p class="hint">Switching the view does not bridge or move your funds. Keep assets and ETH for fees on Ethereum before swapping.</p></section>`;
    $('direct-network').onclick=()=>{if(current())session.choose('ethereum-mainnet');};return()=>{disposed=true;abort.abort();};
  }
  host.innerHTML='<section class="card"><p role="status">Preparing your network details…</p></section>';
  async function open(){let address=wallet.address;
    if(network==='sol-mainnet'){const keys=await deriveMulti(unifiedRoot(wallet),true);try{address=keys.solAddress;}finally{clearMulti(keys);}}
    if(network==='tron-mainnet')address=deriveTronAddress(wallet);
    if(!current())return;
    {
      const supported=['sol-mainnet','ethereum-mainnet','avalanche-mainnet'].includes(network);
      host.innerHTML=`<div class="trade-grid"><section class="card trade-ticket"><div class="eyebrow">BUY WITH A CARD</div><h2>Buy USDT for your wallet</h2><p>Complete your purchase with MoonPay, then receive USDT at your Forma address.</p>${supported?`<div class="trade-asset-preview">${assetLogo('USDT',true,network)}<div><strong>USDT</strong><span>${escape(networkLabel(network))}</span></div><span class="pill">Receiving network</span></div><label>Your public receiving address</label><code class="trade-address">${address}</code><button id="trade-copy" class="quiet" type="button">Copy receiving address</button><label class="check"><input id="trade-ack" type="checkbox"> I will select ${escape(networkLabel(network))} at the provider and compare the full receiving address.</label><a id="trade-provider" class="primary provider-link" target="_blank" rel="noopener noreferrer" aria-disabled="true">Continue to MoonPay ↗</a><p id="trade-message" class="hint" role="status"></p>`:`<p>Choose a network with a reviewed USDT receiving asset below. This does not move or bridge your existing funds.</p>${chooseMarkup()}`}</section><section class="card trade-guide"><h2>Before you buy</h2><ol class="flow-diagram vertical"><li><strong>Choose USDT and the network</strong><span>The provider must offer this exact network.</span></li><li><strong>Paste your receiving address</strong><span>Never enter a recovery phrase or private key.</span></li><li><strong>Review the final cost</strong><span>Check exchange rate, fees and delivery time.</span></li></ol><p>MoonPay handles card details, identity checks and payment. Availability, minimum amounts, fees and supported networks depend on your location and provider checks. No address or card details are sent automatically.</p><p>Forma demo cards cannot fund a real purchase. Keep the network's fee asset to send USDT after it arrives.</p></section></div>`;
      bindChoices();if(supported){$('copy').onclick=()=>{void navigator.clipboard.writeText(address).then(()=>{if(current())$('message').textContent='Public receiving address copied. Check the network before paying.';}).catch(()=>{if(current())$('message').textContent='Copy unavailable. Select and copy the public address manually.';});};const link=$('provider') as HTMLAnchorElement;$('ack').onchange=()=>{const checked=($('ack') as HTMLInputElement).checked;link.setAttribute('aria-disabled',String(!checked));if(checked)link.href=BUY_USDT_URL;else link.removeAttribute('href');};link.onclick=event=>{if(!($('ack') as HTMLInputElement).checked){event.preventDefault();$('message').textContent='Confirm the receiving network and address first.';}};}return;
    }

  }
  void open().catch(()=>{if(current())host.innerHTML='<section class="card"><h2>Could not prepare this account</h2><p>Check that this wallet has a recovery phrase for the selected chain. Your saved wallet has not been changed.</p></section>';});
  return()=>{disposed=true;abort.abort();host.replaceChildren();};
}

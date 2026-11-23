import {Contract,formatUnits,type Wallet,type HDNodeWallet} from 'ethers';
import {networkIds,networkAsset,isMainnetNetwork,type NetworkId} from './network-context';
import {evmNetworks,isAdditionalEvm} from './evm-networks';
import {createRpcProvider} from './rpc-transport';
import {readEvmTokens} from './evm-assets';
import {tokenKey,savedTokens,ERC20_ABI} from './token-data';
import {listedMainnetToken} from './mainnet-tokens';
import {deriveMulti,unifiedRoot,clearMulti} from './multichain-core';
import {readMultiBalance} from './multichain-network';
import {createBitcoinMainnetApi} from './bitcoin-mainnet';
import {createMainnetApi,mainnetMints,mainnetMintsKey,MAINNET_USDT} from './solana-mainnet';
import {splKey,parseMints,readMint,readTokenAccount} from './sol-tokens';
import {deriveTronAddress,parseTronTokens,tronTokenKey} from './tron-core';
import {createTronMainnetReadApi,mainnetTronTokens,tronMainnetTokenKey,TRON_MAINNET_USDT} from './tron-mainnet';
import {readTronBalance,readTrc20Balance} from './tron-network';
import type {AssetDisplayRow} from './asset-display';
export type NetworkHolding=AssetDisplayRow&{network:NetworkId;priceSymbol?:string};
export function environmentNetworks(live:boolean){return networkIds.filter(id=>isMainnetNetwork(id)===live);}
export async function scanNetworks(ids:NetworkId[],read:(id:NetworkId)=>Promise<NetworkHolding[]>,current:()=>boolean,update:(id:NetworkId,rows:NetworkHolding[],failed:boolean)=>void){
  let next=0;await Promise.all(Array.from({length:Math.min(2,ids.length)},async()=>{while(current()&&next<ids.length){const id=ids[next++];let rows:NetworkHolding[];let failed=false;try{rows=await read(id);}catch{const asset=networkAsset(id);rows=[{network:id,id:'native',name:asset.name,symbol:asset.symbol,verified:true}];failed=true;}if(!current())return;update(id,rows,failed);}}));
}
export function createCrossNetworkReader(wallet:Wallet|HDNodeWallet,store:Pick<Storage,'getItem'>,signal:AbortSignal,current:()=>boolean,partial?:(network:NetworkId,rows:NetworkHolding[])=>void){
  const publicAddresses=new Map<boolean,Promise<{btcAddress:string;solAddress:string}>>();
  const addresses=(live:boolean)=>{let value=publicAddresses.get(live);if(!value){value=deriveMulti(unifiedRoot(wallet),live).then(keys=>{try{return{btcAddress:keys.btcAddress,solAddress:keys.solAddress};}finally{clearMulti(keys);}});publicAddresses.set(live,value);}return value;};
  const guard=()=>{if(signal.aborted||!current())throw new Error('Wallet changed.');};
  const providers=new Set<ReturnType<typeof createRpcProvider>>();
  const row=(network:NetworkId,id:string,symbol:string,name:string,amount:bigint|undefined,decimals:number,verified:boolean,token=false,priceSymbol?:string):NetworkHolding=>({network,id,symbol,name,amount:amount===undefined?undefined:formatUnits(amount,decimals),verified,...(token?{kind:'token' as const}:{}),priceSymbol});
  async function read(network:NetworkId):Promise<NetworkHolding[]>{
    guard();const deadline=Date.now()+30000;const live=isMainnetNetwork(network),asset=networkAsset(network),owner=wallet.address;
    if(network==='eth'||isAdditionalEvm(network)){
      const config=network==='eth'?{rpc:import.meta.env.VITE_SEPOLIA_RPC_URL||'https://ethereum-sepolia-rpc.publicnode.com',chainId:11155111}:evmNetworks[network];
      const provider=createRpcProvider(config.rpc);providers.add(provider);
      try{if((await provider.getNetwork()).chainId!==BigInt(config.chainId))throw new Error('Wrong chain.');guard();
        const native=await provider.getBalance(owner);guard();const rows=[row(network,'native',asset.symbol,asset.name,native,18,true,false,asset.symbol)];
        const tokens=network==='eth'?savedTokens(JSON.parse(store.getItem(tokenKey(owner))||'[]')):readEvmTokens(store,network,owner);
        // Serial token reads keep the whole portfolio to at most two in-flight chain calls.
        partial?.(network,rows);for(const token of tokens){guard();let amount:bigint|undefined;try{if(Date.now()>deadline)throw new Error('Scan deadline.');amount=BigInt(await new Contract(token.address,ERC20_ABI,provider).balanceOf(owner));}catch{amount=undefined;}guard();const listed=isAdditionalEvm(network)?listedMainnetToken(network,token.address):undefined;rows.push(row(network,token.address,token.symbol,token.name,amount,token.decimals,!!listed,true,listed?.symbol));partial?.(network,rows);}
        return rows;
      }finally{provider.destroy();providers.delete(provider);}
    }
    if(network==='btc'||network==='btc-mainnet'){
      const keys=await addresses(live);guard();const amount=live?await createBitcoinMainnetApi(signal).balance(keys.btcAddress):(await readMultiBalance('btc',keys)).confirmed;guard();return[row(network,'native','BTC','Bitcoin',amount,8,true,false,'BTC')];
    }
    if(network==='sol'||network==='sol-mainnet'){
      const keys=await addresses(live);guard();const api=createMainnetApi(signal,store.getItem('forma.sol.mainnet.rpc.v1')==='publicnode'?'publicnode':'solana');if(live)await api.identity();guard();
      const amount=live?await api.balance(keys.solAddress):(await readMultiBalance('sol',keys)).confirmed;guard();const rows=[row(network,'native','SOL','Solana',amount,9,true,false,'SOL')];
      const mints=live?mainnetMints(store.getItem(mainnetMintsKey(keys.solAddress))):parseMints(JSON.parse(store.getItem(splKey(keys.solAddress))||'[]'));
      partial?.(network,rows);for(const id of mints){guard();const official=live&&id===MAINNET_USDT;try{if(Date.now()>deadline)throw new Error('Scan deadline.');const mint=live?await api.mint(id):await readMint(id);guard();const value=live?await api.heldBalance(keys.solAddress,mint):(await readTokenAccount(keys.solAddress,mint)).amount;guard();rows.push(row(network,id,official?'USDT':'SPL',official?'Tether USD':'SPL token',value,mint.decimals,official,true,official?'USDT':undefined));}catch{guard();rows.push(row(network,id,official?'USDT':'SPL','SPL token',undefined,6,official,true));}partial?.(network,rows);}return rows;
    }
    const address=deriveTronAddress(wallet);guard();const api=live?createTronMainnetReadApi():{readTronBalance,readTrc20Balance};const value=await api.readTronBalance(address);guard();const rows=[row(network,'native','TRX','TRON',value.balance,6,true,false,'TRX')];
    const tokens=live?mainnetTronTokens(store.getItem(tronMainnetTokenKey(address))):parseTronTokens(JSON.parse(store.getItem(tronTokenKey(address))||'[]'));
    partial?.(network,rows);for(const token of tokens){guard();const official=live&&token.address===TRON_MAINNET_USDT;let amount:bigint|undefined;try{if(Date.now()>deadline)throw new Error('Scan deadline.');amount=await api.readTrc20Balance(address,token.address);}catch{amount=undefined;}guard();rows.push(row(network,token.address,token.symbol,token.name,amount,token.decimals,official,true,official?'USDT':undefined));partial?.(network,rows);}return rows;
  }
  return{read,dispose:()=>{for(const provider of providers)provider.destroy();providers.clear();}};
}

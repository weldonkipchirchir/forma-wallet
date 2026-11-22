import {afterEach,describe,it,expect,vi} from 'vitest';
import {HDNodeWallet,AbiCoder} from 'ethers';
import * as btc from '@scure/btc-signer';
import {hex} from '@scure/base';
import {deriveMulti,clearMulti,btcRecipient,bitcoinPlan,signBitcoin,verifyUtxo} from './multichain-core';
import {createBitcoinMainnetApi,BTC_MAINNET_GENESIS,BTC_MAINNET_API,btcMainnetJournal,btcMainnetJournalKey,retainBtcMainnet} from './bitcoin-mainnet';
import {createTronMainnetReadApi,TRON_MAINNET_GENESIS,TRON_MAINNET_USDT,mainnetTronTokens,tronMainnetTokenKey,TRON_MAINNET_RPC} from './tron-mainnet';
import {tronTokenKey,tronHexAddress,TRON_NILE_GENESIS} from './tron-core';
import {networkIds,isMainnetNetwork,supportsPage,usesNativeWorkspace,savedNetwork} from './network-context';
import {listedMainnetTokens} from './mainnet-tokens';
import {securityHeaders,DEFAULT_RPC} from '../security-policy.mjs';
const phrase='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root=()=>HDNodeWallet.fromPhrase(phrase);
const owner='TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';
const json=(value:unknown)=>new Response(JSON.stringify(value));
afterEach(()=>vi.unstubAllGlobals());
async function fixture(){const keys=await deriveMulti(root(),true),tx=new btc.Transaction({allowUnknownInputs:true});tx.addInput({txid:'01'.repeat(32),index:0});tx.addOutputAddress(keys.btcAddress,100000n,btc.NETWORK);const raw=tx.unsignedTx,id=btc.Transaction.fromRaw(raw).id;return{keys,raw,id,input:verifyUtxo(raw,id,0,100000n,keys.btcScript)};}
describe('Bitcoin Mainnet isolation and reviewed signing',()=>{
  it('matches BIP84 public vector and keeps old testnet/Solana derivation stable',async()=>{
    const main=await deriveMulti(root(),true),test=await deriveMulti(root());
    expect(main.btcAddress).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(test.btcAddress).toMatch(/^tb1q/);expect(test.solAddress).toBe(main.solAddress);
    expect(()=>btcRecipient(main.btcAddress)).toThrow('Testnet');expect(()=>btcRecipient(test.btcAddress,true)).toThrow('Mainnet');
    expect(()=>btcRecipient(main.btcAddress.slice(0,-1)+'q',true)).toThrow();
    expect(()=>btcRecipient('bc1p'+'q'.repeat(58),true)).toThrow();clearMulti(main);clearMulti(test);
  });
  it('conserves satoshis and binds Mainnet recipient/change, input and fee before signing',async()=>{
    const {keys,input}=await fixture();const recipient=(await deriveMulti(HDNodeWallet.fromPhrase('test test test test test test test test test test test junk'),true)).btcAddress;
    const plan=bitcoinPlan(keys,recipient,20000n,2,[input]),signed=signBitcoin(plan,keys),decoded=btc.Transaction.fromRaw(hex.decode(signed.raw));
    expect(decoded.id).toBe(signed.id);expect(decoded.getOutputAddress(0,btc.NETWORK)).toBe(recipient);expect(decoded.getOutputAddress(1,btc.NETWORK)).toBe(keys.btcAddress);
    expect(plan.amount+plan.fee+plan.change).toBe(100000n);
    const altered=bitcoinPlan(keys,recipient,20000n,2,[input]);altered.tx.updateOutput(0,{amount:21000n});expect(()=>signBitcoin(altered,keys)).toThrow('review changed');
    expect(()=>bitcoinPlan(keys,recipient,2100000000000001n,2,[input])).toThrow('supply');
    expect(()=>bitcoinPlan(keys,recipient,1n,2,[input])).toThrow('dust');expect(()=>bitcoinPlan(keys,recipient,20000n,101,[input])).toThrow('Fee rate');
    clearMulti(keys);expect(()=>signBitcoin(plan,keys)).toThrow('locked');
  });
  it('checks Mainnet genesis and cryptographic previous output ownership before funding',async()=>{
    const {keys,raw,id}=await fixture();let wrong=false,forged=false;
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{expect(url.startsWith(BTC_MAINNET_API)).toBe(true);expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');
      if(url.endsWith('/block-height/0'))return new Response(wrong?'wrong':BTC_MAINNET_GENESIS);
      if(url.endsWith('/utxo'))return json([{txid:id,vout:0,value:forged?100001:100000,status:{confirmed:true}}]);
      if(url.endsWith('/hex'))return new Response(hex.encode(raw));return json({chain_stats:{funded_txo_sum:100000,spent_txo_sum:0}});
    }));const api=createBitcoinMainnetApi();expect(await api.balance(keys.btcAddress)).toBe(100000n);expect(await api.funding(keys)).toHaveLength(1);
    forged=true;await expect(api.funding(keys)).rejects.toThrow('ownership');wrong=true;await expect(api.balance(keys.btcAddress)).rejects.toThrow('Wrong Bitcoin');clearMulti(keys);
  });
  it('blocks spent inputs, leaves missing status unknown and broadcasts only once with exact ID',async()=>{
    const {keys,input}=await fixture(),signed=signBitcoin(bitcoinPlan(keys,keys.btcAddress,20000n,2,[input]),keys);let posts=0,spent=true,bad=false;
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{if(init.method==='POST'){posts++;expect(init.body).toBe(signed.raw);return new Response(bad?'00'.repeat(32):signed.id);}return json(url.includes('/outspend/')?{spent}:{});}));
    const api=createBitcoinMainnetApi();await expect(api.unspent(signed.id,0)).rejects.toThrow('spent');spent=false;await api.unspent(signed.id,0);expect(await api.status(signed.id)).toBe('unknown');
    await api.broadcast(signed.raw,signed.id);expect(posts).toBe(1);bad=true;await expect(api.broadcast(signed.raw,signed.id)).rejects.toThrow('differs');expect(posts).toBe(2);clearMulti(keys);
  });
  it('fails closed for corrupt journals, preserves uncertainty and isolates the Mainnet namespace',async()=>{
    const {keys}=await fixture(),row={id:'11'.repeat(32),to:keys.btcAddress,amount:'1000',fee:'300',when:1,status:'unknown' as const};
    expect(btcMainnetJournalKey(keys.btcAddress)).toContain('mainnet');expect(retainBtcMainnet([],row)).toEqual([row]);
    for(const raw of ['{}','x'.repeat(100001),JSON.stringify([row,row]),JSON.stringify([{...row,to:'tb1q'+'a'.repeat(38)}]),JSON.stringify([{...row,fee:'100001'}])])expect(()=>btcMainnetJournal(raw)).toThrow();clearMulti(keys);
  });
  it('rejects oversized Mainnet responses before using account data',async()=>{
    const {keys}=await fixture();vi.stubGlobal('fetch',vi.fn(async()=>new Response('x',{headers:{'Content-Length':'2000001'}})));
    await expect(createBitcoinMainnetApi().balance(keys.btcAddress)).rejects.toThrow('size');clearMulti(keys);
  });
});
describe('TRON Mainnet read-only boundary',()=>{
  it('pins issuer USDT metadata and isolates network/account caches',()=>{
    const known=mainnetTronTokens(JSON.stringify([{address:TRON_MAINNET_USDT,name:'Fake',symbol:'FAKE',decimals:18}]));
    expect(known).toEqual([{address:TRON_MAINNET_USDT,name:'Tether USD',symbol:'USDT',decimals:6}]);
    expect(tronMainnetTokenKey(owner)).not.toBe(tronTokenKey(owner));expect(Object.keys(createTronMainnetReadApi()).some(key=>/sign|send|broadcast/i.test(key))).toBe(false);
  });
  it('rejects Nile identity, wrong account, unsafe responses and credentials',async()=>{
    let genesis=TRON_NILE_GENESIS,account:unknown={address:tronHexAddress(owner),balance:12345};
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{expect(url.startsWith(TRON_MAINNET_RPC)).toBe(true);expect(init.credentials).toBe('omit');expect(init.redirect).toBe('error');return json(url.endsWith('getblockbynum')?{blockID:genesis}:account);}));
    const api=createTronMainnetReadApi();await expect(api.readTronBalance(owner)).rejects.toThrow('Wrong TRON');genesis=TRON_MAINNET_GENESIS;
    expect(await api.readTronBalance(owner)).toEqual({balance:12345n,activated:true});account={};expect(await api.readTronBalance(owner)).toEqual({balance:0n,activated:false});account={address:TRON_MAINNET_USDT,balance:1};await expect(api.readTronBalance(owner)).rejects.toThrow('Wrong TRON account');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{headers:{'Content-Length':'1000001'}})));await expect(api.readTronBalance(owner)).rejects.toThrow('size');
  });
  it('reads exact TRC-20 quantities and rejects changed official decimals',async()=>{
    const abi=AbiCoder.defaultAbiCoder();let decimals=6;
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{if(url.endsWith('getblockbynum'))return json({blockID:TRON_MAINNET_GENESIS});const req=JSON.parse(String(init.body)),selector=req.function_selector;
      if(selector==='balanceOf(address)')expect(req.parameter).toBe(tronHexAddress(owner).slice(2).padStart(64,'0'));
      const value=selector==='name()'?abi.encode(['string'],['Tether USD']):selector==='symbol()'?abi.encode(['string'],['USDT']):abi.encode(['uint256'],[selector==='decimals()'?decimals:123450000n]);return json({result:{result:true},constant_result:[value.slice(2)]});}));
    const api=createTronMainnetReadApi();expect((await api.readTrc20Token(owner,TRON_MAINNET_USDT)).decimals).toBe(6);expect(await api.readTrc20Balance(owner,TRON_MAINNET_USDT)).toBe(123450000n);decimals=18;await expect(api.readTrc20Token(owner,TRON_MAINNET_USDT)).rejects.toThrow('decimals');
  });
});
describe('expanded Mainnet capability routing',()=>{
  it('registers isolated native mainnets and excludes unsupported pages',()=>{
    expect(networkIds).toHaveLength(34);expect(networkIds.filter(isMainnetNetwork)).toHaveLength(19);
    for(const id of ['btc-mainnet','tron-mainnet'] as const){expect(networkIds).toContain(id);expect(savedNetwork(id)).toBe(id);expect(isMainnetNetwork(id)).toBe(true);expect(usesNativeWorkspace(id,'transfer')).toBe(false);expect(supportsPage(id,'ledger')).toBe(false);expect(supportsPage(id,'contacts')).toBe(false);}
    expect(supportsPage('btc-mainnet','tokens')).toBe(false);expect(supportsPage('tron-mainnet','tokens')).toBe(true);
    const csp=securityHeaders(new URL(DEFAULT_RPC),true)['Content-Security-Policy'];expect(csp).toContain('https://api.trongrid.io');expect(csp).toContain('https://blockstream.info');expect(csp).not.toContain('connect-src https:');
  });
  it('adds issuer-listed USDC only on reviewed deployments',()=>{
    for(const id of ['worldchain-mainnet','celo-mainnet','sonic-mainnet'] as const)expect(listedMainnetTokens(id).find(row=>row.symbol==='USDC')?.decimals).toBe(6);
    for(const id of ['gnosis-mainnet','soneium-mainnet','scroll-mainnet'] as const)expect(listedMainnetTokens(id)).toEqual([]);
  });
});

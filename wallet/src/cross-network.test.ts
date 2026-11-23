import {afterEach,describe,it,expect,vi} from 'vitest';
import {Wallet,AbiCoder} from 'ethers';
import {backupPositions} from './recovery-words';
import {environmentNetworks,scanNetworks,createCrossNetworkReader,type NetworkHolding} from './cross-network-data';
import {portfolioRows} from './cross-network-ui';
import {isMainnetNetwork} from './network-context';
import {evmTokenKey} from './evm-assets';
import {listedMainnetTokens} from './mainnet-tokens';
afterEach(()=>vi.unstubAllGlobals());
describe('cross-network portfolio isolation and read boundaries',()=>{
  it('never mixes live and test networks, and leaves failed reads unavailable',async()=>{
    expect(environmentNetworks(true)).toHaveLength(19);expect(environmentNetworks(false)).toHaveLength(15);expect(environmentNetworks(true).every(isMainnetNetwork)).toBe(true);expect(environmentNetworks(false).some(isMainnetNetwork)).toBe(false);
    const updates:NetworkHolding[][]=[];await scanNetworks(['btc-mainnet'],async()=>{throw Error('offline');},()=>true,(_id,rows)=>updates.push(rows));expect(updates[0][0].amount).toBeUndefined();
  });
  it('limits network work to two jobs and suppresses updates after disposal',async()=>{
    let active=0,max=0,live=true;const updates:string[]=[];
    await scanNetworks(['sol-mainnet','btc-mainnet','tron-mainnet'],async id=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return[{network:id,id:'native',symbol:'SOL',name:'Synthetic',amount:'1'}];},()=>live,id=>{updates.push(id);live=false;});expect(max).toBeLessThanOrEqual(2);expect(updates).toHaveLength(1);
  });
  it('reads only reviewed-chain/account balances and does not price spoofed stablecoin names',async()=>{
    const wallet=new Wallet('0x'+'11'.repeat(32)),known=listedMainnetTokens('ethereum-mainnet')[0],fake={address:'0x'+'22'.repeat(20),name:'Fake USD',symbol:'USDT',decimals:6};
    const store={getItem:(key:string)=>key===evmTokenKey('ethereum-mainnet',wallet.address)?JSON.stringify([fake]):null};
    const abi=AbiCoder.defaultAbiCoder();let wrong=false;
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{const raw=init.body;const requests=JSON.parse(typeof raw==='string'?raw:new TextDecoder().decode(raw as Uint8Array));const answer=(r:any)=>({jsonrpc:'2.0',id:r.id,result:r.method==='eth_chainId'?(wrong?'0x38':'0x1'):r.method==='eth_getBalance'?(expect(r.params[0].toLowerCase()).toBe(wallet.address.toLowerCase()),'0xde0b6b3a7640000'):r.method==='eth_call'?abi.encode(['uint256'],[2000000n]):null});return new Response(JSON.stringify(Array.isArray(requests)?requests.map(answer):answer(requests)));}));
    const reader=createCrossNetworkReader(wallet,store,new AbortController().signal,()=>true);const rows=await reader.read('ethereum-mainnet');expect(rows[0].amount).toBe('1.0');expect(rows.find(row=>row.id===known.address)?.verified).toBe(true);expect(rows.find(row=>row.id===fake.address)?.priceSymbol).toBeUndefined();expect(rows.find(row=>row.id===fake.address)?.verified).toBe(false);reader.dispose();
    wrong=true;const bad=createCrossNetworkReader(wallet,store,new AbortController().signal,()=>true);await expect(bad.read('ethereum-mainnet')).rejects.toThrow('Wrong chain');bad.dispose();
  });
  it('filters every tracked row by chain/search/zero without hiding unavailable results',()=>{
    const rows:NetworkHolding[]=[{network:'sol-mainnet',id:'native',symbol:'SOL',name:'Solana',amount:'0.0'},{network:'ethereum-mainnet',id:'native',symbol:'ETH',name:'Ethereum',amount:undefined}];
    expect(portfolioRows(rows,'','all',true)).toEqual([rows[1]]);expect(portfolioRows(rows,'sol','all',false)).toEqual([rows[0]]);expect(portfolioRows(rows,'','ethereum-mainnet',false)).toEqual([rows[1]]);
  });
});
describe('backup challenge positions',()=>{it('requests three unique valid word positions and rejects unsupported lengths',()=>{for(const length of [12,15,18,21,24]){const positions=backupPositions(length,()=>7);expect(new Set(positions).size).toBe(3);expect(positions.every(index=>index>=0&&index<length)).toBe(true);}expect(()=>backupPositions(1)).toThrow();});});

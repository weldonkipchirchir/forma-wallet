import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMainnetApi, SOL_MAINNET_CONNECTIONS, SOL_MAINNET_GENESIS, SOL_MAINNET_RPC, MAINNET_USDT, mainnetMints, mainnetMintsKey, mainnetJournal, mainnetJournalKey, retainMainnetSubmission, type MainnetSubmission } from './solana-mainnet';
import { splKey } from './sol-tokens';
import { assetTable } from './asset-display';
import { supportsPage, savedNetwork } from './network-context';
import { HDNodeWallet } from 'ethers';
import { deriveMulti, clearMulti, solTransfer, signSol } from './multichain-core';
import { splTransaction, signSpl } from './sol-tokens';
const owner='11111111111111111111111111111111';
const row:MainnetSubmission={id:'2'.repeat(88),to:MAINNET_USDT,amount:'1000000',decimals:6,mint:MAINNET_USDT,expiry:300,when:1000,status:'unknown'};
afterEach(()=>vi.unstubAllGlobals());
function mock(result:(method:string,params:any[])=>unknown){const fetch=vi.fn(async(_url,init)=>{const data=JSON.parse(init.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:data.id,result:result(data.method,data.params)}));});vi.stubGlobal('fetch',fetch);return fetch;}
describe('isolated Solana Mainnet',()=>{
  it('pins manual provider selection and never retries or silently fails over a broadcast',async()=>{
    const fetch=mock(()=>SOL_MAINNET_GENESIS);await createMainnetApi(undefined,'publicnode').identity();expect(fetch.mock.calls[0][0]).toBe(SOL_MAINNET_CONNECTIONS.publicnode);
    expect(()=>createMainnetApi(undefined,'https://example.com' as any)).toThrow('Unsupported');
    const failed=vi.fn(async()=>new Response('',{status:429}));vi.stubGlobal('fetch',failed);await expect(createMainnetApi(undefined,'publicnode').rpc('sendTransaction',['synthetic'])).rejects.toThrow('unavailable');expect(failed).toHaveBeenCalledTimes(1);
  });
  it('counts classic tokens across owned associated and non-associated accounts without trusting wrong owners or duplicate rows',async()=>{
    const mint={mint:MAINNET_USDT,decimals:6,mintAuthority:null,freezeAuthority:null};
    const account={owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{type:'account',info:{owner,mint:MAINNET_USDT,state:'initialized',tokenAmount:{amount:'123',decimals:6}}}}};
    let rows=[{pubkey:MAINNET_USDT,account},{pubkey:'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',account}];
    mock(()=>({value:rows}));expect(await createMainnetApi().heldBalance(owner,mint)).toBe(246n);
    rows=[rows[0],rows[0]];await expect(createMainnetApi().heldBalance(owner,mint)).rejects.toThrow('Duplicate');
    rows=[{...rows[0],account:{...account,data:{parsed:{type:'account',info:{...account.data.parsed.info,owner:MAINNET_USDT}}}}}];await expect(createMainnetApi().heldBalance(owner,mint)).rejects.toThrow('another');
  });
  it('separates persistence and includes issuer-listed USDT automatically',()=>{
    expect(mainnetMints(null)).toEqual([MAINNET_USDT]);expect(mainnetMints(JSON.stringify([MAINNET_USDT,owner]))).toEqual([MAINNET_USDT,owner]);
    expect(mainnetMintsKey(owner)).not.toBe(splKey(owner));expect(mainnetJournalKey(owner)).toContain('mainnet');
    expect(savedNetwork('sol-mainnet')).toBe('sol-mainnet');expect(supportsPage('sol-mainnet','transfer')).toBe(true);expect(supportsPage('sol-mainnet','watch')).toBe(false);
  });
  it('rejects Devnet and mismatched RPC identities before proceeding',async()=>{
    const fetch=mock(()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
    await expect(createMainnetApi().identity()).rejects.toThrow('Wrong Solana network');expect(fetch).toHaveBeenCalledTimes(1);
    mock(()=>SOL_MAINNET_GENESIS);await expect(createMainnetApi().identity()).resolves.toBeUndefined();
  });
  it('pins RPC transport with no credentials/redirects/retry and validates envelope',async()=>{
    const fetch=mock(()=>0);await createMainnetApi().rpc('getBlockHeight');expect(fetch.mock.calls[0][0]).toBe(SOL_MAINNET_RPC);expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"jsonrpc":"2.0","id":999,"result":0}')));await expect(createMainnetApi().rpc('getBlockHeight')).rejects.toThrow();
  });
  it('fails closed on malformed journals and preserves unresolved submissions',()=>{
    expect(mainnetJournal(JSON.stringify([row]))).lengthOf(1);
    for(const value of ['{','{}',JSON.stringify([{...row,to:1}]),JSON.stringify([{...row,amount:'0'}]),JSON.stringify([row,row])])expect(()=>mainnetJournal(value)).toThrow();
    let records=[row];for(let i=0;i<150;i++)records=retainMainnetSubmission(records,{...row,id:'3'.repeat(84)+String(i).padStart(4,'1').replace(/0/g,'1'),status:'confirmed'});
    expect(records.some(item=>item.id===row.id&&item.status==='unknown')).toBe(true);
  });
  it('does not label Mainnet money as testnet or USDT as native SOL',()=>{
    const html=assetTable([{id:MAINNET_USDT,symbol:'USDT',name:'Tether',verified:true,kind:'token',amount:'3',usd:2.99}],false,true,'mainnet');
    expect(html).toContain('Estimated priced subtotal');expect(html).toContain('Issuer-listed mint');expect(html).not.toContain('Test assets have no monetary value');expect(html).not.toContain('Native asset');
  });
  it('validates official mint decimals and rejects oversized transport',async()=>{
    mock(()=>({value:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{type:'mint',info:{isInitialized:true,decimals:9,mintAuthority:null,freezeAuthority:null}}}}}));await expect(createMainnetApi().mint(MAINNET_USDT)).rejects.toThrow('decimals');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-length':'2000001'}})));await expect(createMainnetApi().rpc('getGenesisHash')).rejects.toThrow('size');
  });
  it('signs exact native and official USDT intent and rejects changed amounts',async()=>{
    const keys=await deriveMulti(HDNodeWallet.fromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
    const to='GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',blockhash=MAINNET_USDT;
    try {
      const native=solTransfer(keys,to,10000000n,blockhash);
      await expect(signSol(native,keys,to,10000001n)).rejects.toThrow('review changed');
      expect((await signSol(native,keys,to,10000000n)).raw.length).toBeGreaterThan(0);
      const mint={mint:MAINNET_USDT,decimals:6,mintAuthority:null,freezeAuthority:null};
      const token=await splTransaction(keys.solAddress,to,mint,1250000n,blockhash);
      await expect(signSpl(token,keys,to,mint,1250001n)).rejects.toThrow('review changed');
      expect((await signSpl(token,keys,to,mint,1250000n)).raw.length).toBeGreaterThan(0);
    } finally {clearMulti(keys);}
  });
});

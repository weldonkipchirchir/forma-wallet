import {describe,it,expect,vi} from 'vitest';
import {base58} from '@scure/base';
import {parseSolTransaction,loadSolHistory} from './solana-history';
import {MAINNET_USDC} from './solana-mainnet';
const owner='11111111111111111111111111111111',peer='GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB',hash=base58.encode(new Uint8Array(64).fill(1));
function tx(sent=false){const source=sent?owner:peer,destination=sent?peer:owner;return{blockTime:1795440000,transaction:{signatures:[hash],message:{accountKeys:[{pubkey:source},{pubkey:destination},{pubkey:MAINNET_USDC}],instructions:[{programId:owner,parsed:{type:'transfer',info:{source,destination,lamports:5000000}}}]}},meta:{err:null,fee:5000,preBalances:[1000000000,0,0],postBalances:[994995000,5000000,0],preTokenBalances:[],postTokenBalances:[],innerInstructions:[]}};}
describe('on-chain Solana activity',()=>{
  it('shows native deposits and outgoing transfer amounts without counting the fee as sent SOL',()=>{
    expect(parseSolTransaction(hash,owner,tx())[0]).toMatchObject({direction:'received',amount:5000000n,peer,status:'confirmed'});expect(parseSolTransaction(hash,owner,tx(true))[0]).toMatchObject({direction:'sent',amount:5000000n,peer});
  });
  it('includes issuer-listed token changes and preserves ambiguous historical balances as unavailable',()=>{
    const value:any=tx();value.meta.postTokenBalances=[{accountIndex:2,mint:MAINNET_USDC,owner,uiTokenAmount:{amount:'2500000',decimals:6}}];let rows=parseSolTransaction(hash,owner,value);expect(rows.find(row=>row.mint===MAINNET_USDC)).toMatchObject({symbol:'USDC',direction:'received',amount:2500000n,decimals:6});
    value.meta.preTokenBalances=[{accountIndex:2,mint:MAINNET_USDC,uiTokenAmount:{amount:'1000000',decimals:6}}];rows=parseSolTransaction(hash,owner,value);expect(rows.find(row=>row.mint===MAINNET_USDC)).toMatchObject({status:'unavailable',amount:undefined});
  });
  it('never labels failed or missing transactions as successful transfers and rejects wrong-wallet data',()=>{
    const value:any=tx();value.meta.err={InstructionError:[0,'Failed']};expect(parseSolTransaction(hash,owner,value)[0]).toMatchObject({status:'failed',direction:'activity'});expect(parseSolTransaction(hash,owner,value)[0].amount).toBeUndefined();expect(parseSolTransaction(hash,owner,null)[0].status).toBe('unavailable');value.transaction.signatures=['bad'];expect(()=>parseSolTransaction(hash,owner,value)).toThrow('signature mismatch');
  });
  it('finds token-account deposits when the wallet public key is absent from transaction keys',async()=>{
    const tokenAccount='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',value:any=tx();value.transaction.message.accountKeys=[{pubkey:peer},{pubkey:tokenAccount}];value.transaction.message.instructions=[];value.meta.preBalances=[0,0];value.meta.postBalances=[0,0];value.meta.postTokenBalances=[{accountIndex:1,mint:MAINNET_USDC,owner,uiTokenAmount:{amount:'12500000',decimals:6}}];
    const api={identity:async()=>{},rpc:vi.fn(async(method:string,params:any[])=>method==='getTokenAccountsByOwner'?{value:[{pubkey:tokenAccount,account:{owner:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',data:{parsed:{info:{owner}}}}}]}:method==='getSignaturesForAddress'?(params[0]===tokenAccount?[{signature:hash}]:[]):value)};
    const page=await loadSolHistory(api,owner,()=>true);expect(page.rows[0]).toMatchObject({direction:'received',amount:12500000n,symbol:'USDC'});expect(page.cursor).toBeUndefined();
  });
  it('bounds history concurrency and rejects duplicate signatures',async()=>{
    const hashes=Array.from({length:5},(_,index)=>base58.encode(new Uint8Array(64).fill(index+1)));let active=0,max=0;
    const api={identity:vi.fn(async()=>{}),rpc:vi.fn(async(method:string,params:any[])=>{if(method==='getSignaturesForAddress')return hashes.map(signature=>({signature}));active++;max=Math.max(max,active);await Promise.resolve();active--;const value=tx();value.transaction.signatures=[params[0]];return value;})};const page=await loadSolHistory(api,owner,()=>true);expect(page.rows).toHaveLength(5);expect(max).toBeLessThanOrEqual(2);expect(page.cursor?.before[owner]).toBe(hashes[4]);expect(api.identity).toHaveBeenCalledOnce();
    api.rpc=vi.fn(async()=>[{signature:hash},{signature:hash}]) as any;await expect(loadSolHistory(api,owner,()=>true)).rejects.toThrow('duplicate');
  });
});

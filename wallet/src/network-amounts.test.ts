import { describe,it,expect } from 'vitest';
import { bitcoinMovements,solanaMovements } from './network-amounts';
const owner='6kVTcNchJxMmkwnLaEktzXyCZpoYi8KUAvQ5xGHBXDjJ', other='HBY78XMozmgC2mNYtqxEQbaLxCBd9gvQfvo9uM8ANYCP';
const mint='So11111111111111111111111111111111111111112';
const transfer=(source:string,destination:string,lamports:number)=>({programId:'11111111111111111111111111111111',parsed:{type:'transfer',info:{source,destination,lamports}}});
const tx=(instructions:any[])=>({transaction:{message:{instructions}},meta:{err:null,fee:5000,innerInstructions:[],preTokenBalances:[],postTokenBalances:[]}});
describe('network history amounts',()=>{
  it('shows incoming SOL independently of fees and includes inner transfers',()=>{
    const value=tx([transfer(other,owner,123456789)]);
    value.meta.innerInstructions=[{instructions:[transfer(other,owner,1)]}] as any;
    expect(solanaMovements(value,owner)).toEqual([{amount:123456790n,decimals:9,asset:'devSOL',direction:'received'}]);
  });
  it('shows sent SOL without adding fees and ignores self transfers and failed transactions',()=>{
    const value=tx([transfer(owner,other,1000000000),transfer(owner,owner,123)]);
    expect(solanaMovements(value,owner)[0].amount).toBe(-1000000000n);
    expect(solanaMovements(value,owner)[0].direction).toBe('sent');
    value.meta.err={InstructionError:[0,'failure']} as any;
    expect(solanaMovements(value,owner)).toEqual([]);
    expect(solanaMovements(null,owner)).toEqual([]);
  });
  it('preserves SPL integer precision and aggregates accounts by mint and owner',()=>{
    const value=tx([]), balance=(amount:string,index:number,who=owner)=>({accountIndex:index,mint,owner:who,uiTokenAmount:{amount,decimals:6}});
    value.meta.preTokenBalances=[balance('9007199254740993',0),balance('10',1),balance('999',2,other)] as any;
    value.meta.postTokenBalances=[balance('9007199254741093',0),balance('20',1)] as any;
    expect(solanaMovements(value,owner)).toEqual([{amount:110n,decimals:6,asset:'SPL',direction:'received',mint}]);
    value.meta.postTokenBalances=[balance('9007199254741093',0),balance('9007199254741093',0)] as any;
    expect(()=>solanaMovements(value,owner)).toThrow();
  });
  it('rejects unsafe native values instead of inventing an amount',()=>{
    expect(()=>solanaMovements(tx([transfer(other,owner,Number.MAX_SAFE_INTEGER+1)]),owner)).toThrow();
  });
  it('labels Bitcoin address changes separately because outgoing changes include fees',()=>{
    const btc={vin:[{prevout:{scriptpubkey_address:owner,value:100000}}],vout:[{scriptpubkey_address:owner,value:48000},{scriptpubkey_address:other,value:50000}]};
    expect(bitcoinMovements(btc,owner)).toEqual([{amount:-52000n,decimals:8,asset:'tBTC',direction:'change'}]);
    expect(bitcoinMovements(btc,other)).toEqual([{amount:50000n,decimals:8,asset:'tBTC',direction:'received'}]);
  });
});

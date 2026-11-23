import {describe,it,expect} from 'vitest';
import {id} from 'ethers';
import {saveWalletCopy} from './wallet-migration';
import {depositContracts,type DepositReceipt} from './deposit-check';
const owner='0x'+'11'.repeat(20),contract='0x'+'22'.repeat(20),hash='0x'+'33'.repeat(32);
const vault=(address:string)=>JSON.stringify({address,version:3,Crypto:{ciphertext:'11'.repeat(32),cipherparams:{iv:'22'.repeat(16)},mac:'33'.repeat(32),cipher:'aes-128-ctr',kdf:'scrypt',kdfparams:{salt:'44'.repeat(32),n:131072,r:8,p:1,dklen:32}}});
function store(){const rows=new Map<string,string>();return {rows,getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);}};}
describe('multiple independent encrypted wallets',()=>{
  it('preserves existing wallets while creating, restoring and switching encrypted copies',()=>{
    const storage=store(),a=vault('11'.repeat(20)),b=vault('22'.repeat(20));storage.setItem('active',a);
    saveWalletCopy(storage,'saved','active',b,contract);expect(storage.getItem('active')).toBe(b);expect(JSON.parse(storage.getItem('saved')!)).toEqual({['11'.repeat(20)]:a,['22'.repeat(20)]:b});
    saveWalletCopy(storage,'saved','active',a,owner);expect(storage.getItem('active')).toBe(a);expect(Object.keys(JSON.parse(storage.getItem('saved')!))).toHaveLength(2);
  });
  it('does not replace the active wallet when archive storage or identity validation fails',()=>{
    const storage=store(),a=vault('11'.repeat(20)),b=vault('22'.repeat(20));storage.setItem('active',a);
    expect(()=>saveWalletCopy(storage,'saved','active',b,owner)).toThrow('match');expect(storage.getItem('active')).toBe(a);
    expect(()=>saveWalletCopy({...storage,setItem:()=>{throw Error('quota');}},'saved','active',b,contract)).toThrow('quota');expect(storage.getItem('active')).toBe(a);
    storage.setItem('saved','[]');expect(()=>saveWalletCopy(storage,'saved','active',b,contract)).toThrow('preserved');expect(storage.getItem('active')).toBe(a);
  });
});
describe('read-only missing-deposit receipt interpretation',()=>{
  const log={address:contract,topics:[id('Transfer(address,address,uint256)'),'0x'+'00'.repeat(32),'0x'+owner.slice(2).padStart(64,'0')],data:'0x'+(123n).toString(16).padStart(64,'0')};
  const receipt=():DepositReceipt=>({hash,status:1,logs:[log]});
  it('returns incoming exact contracts, deduplicates them and excludes NFTs/outgoing/zero transfers',()=>{
    expect(depositContracts({...receipt(),logs:[log,log,{...log,topics:[...log.topics,'0x'+'00'.repeat(32)]},{...log,topics:[log.topics[0],log.topics[1],'0x'+'00'.repeat(32)]},{...log,data:'0x'+'00'.repeat(32)}]},hash,owner)).toEqual([contract]);
  });
  it('fails closed for another transaction, failure, excessive logs and malformed quantities',()=>{
    expect(()=>depositContracts({...receipt(),hash:'0x'+'44'.repeat(32)},hash,owner)).toThrow('identity');
    expect(()=>depositContracts({...receipt(),status:0},hash,owner)).toThrow('successfully');
    expect(()=>depositContracts({...receipt(),logs:Array(2001).fill(log)},hash,owner)).toThrow('Too many');
    expect(depositContracts({...receipt(),logs:[{...log,data:'0x123'}]},hash,owner)).toEqual([]);
  });
});

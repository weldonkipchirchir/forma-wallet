import { describe,it,expect,vi,afterEach } from 'vitest';
import { HDNodeWallet } from 'ethers';
import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import { deriveMulti,clearMulti,SOL_GENESIS } from './multichain-core';
import { TOKEN_PROGRAM,parseMints,mintInfo,accountAmount,splUnits,splTransaction,signSpl,readMint,tokenAddress } from './sol-tokens';
const mint='So11111111111111111111111111111111111111112';
const owner='6kVTcNchJxMmkwnLaEktzXyCZpoYi8KUAvQ5xGHBXDjJ', to='HBY78XMozmgC2mNYtqxEQbaLxCBd9gvQfvo9uM8ANYCP';
const info={mint,decimals:9,mintAuthority:null,freezeAuthority:null};
const mintData=()=>({owner:TOKEN_PROGRAM.toBase58(),data:{parsed:{type:'mint',info:{decimals:9,isInitialized:true,mintAuthority:null,freezeAuthority:null}}}});
const accountData=()=>({owner:TOKEN_PROGRAM.toBase58(),data:{parsed:{type:'account',info:{owner,mint,state:'initialized',tokenAmount:{amount:'1234567890',decimals:9}}}}});
afterEach(()=>vi.unstubAllGlobals());
describe('classic SPL testnet boundaries',()=>{
  it('preserves u64 precision, handles zero-decimal tokens and rejects excess precision',()=>{
    expect(splUnits('18446744073709551615',0)).toBe(0xffffffffffffffffn);
    expect(splUnits('1.000000001',9)).toBe(1000000001n);
    for(const value of ['0','-1','1e4','1.0','18446744073709551616']) expect(()=>splUnits(value,0)).toThrow();
    expect(()=>splUnits('0.001',2)).toThrow();
  });
  it('rejects nonclassic, uninitialized and malformed mints',()=>{
    expect(mintInfo(mint,mintData())).toEqual(info);
    const bad={...mintData(),owner:'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'}; expect(()=>mintInfo(mint,bad)).toThrow();
    const frozen=mintData(); frozen.data.parsed.info.isInitialized=false; expect(()=>mintInfo(mint,frozen)).toThrow();
    expect(parseMints([mint,mint,'invalid',null])).toEqual([mint]);
  });
  it('checks token program, mint, owner, state and exact integer amount',()=>{
    expect(accountAmount(accountData(),owner,info)).toBe(1234567890n);
    const bad=accountData(); bad.data.parsed.info.state='frozen'; expect(()=>accountAmount(bad,owner,info)).toThrow();
    expect(()=>accountAmount(accountData(),to,info)).toThrow();
    expect(()=>accountAmount(accountData(),owner,{...info,decimals:6})).toThrow();
    const overflow=accountData(); overflow.data.parsed.info.tokenAmount.amount='18446744073709551616'; expect(()=>accountAmount(overflow,owner,info)).toThrow();
  });
  it('builds TransferChecked with exact mint, ATAs, amount and signer and rejects injected instructions',async()=>{
    const keys=await deriveMulti(HDNodeWallet.fromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
    try {
      const tx=await splTransaction(keys.solAddress,to,info,1234567890n,mint);
      const ix=tx.instructions[0];
      expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM.toBase58());
      expect([...ix.data]).toEqual([12,210,2,150,73,0,0,0,0,9]);
      expect(ix.keys.map(k=>k.pubkey.toBase58())).toEqual([await tokenAddress(keys.solAddress,mint),mint,await tokenAddress(to,mint),keys.solAddress]);
      expect((await signSpl(tx,keys,to,info,1234567890n)).id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
      await expect(signSpl(tx,keys,to,info,1234567891n)).rejects.toThrow('review changed');
      tx.add(new TransactionInstruction({programId:new PublicKey('11111111111111111111111111111111'),keys:[],data:new Uint8Array()}));
      await expect(signSpl(tx,keys,to,info,1234567890n)).rejects.toThrow('review changed');
    } finally {clearMulti(keys);}
  });
  it('checks Devnet genesis before loading mint metadata',async()=>{
    const calls:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any)=>{const method=JSON.parse(options.body).method;calls.push(method);return new Response(JSON.stringify({result:method==='getGenesisHash'?SOL_GENESIS:{value:mintData()}}));}));
    expect(await readMint(mint)).toEqual(info); expect(calls).toEqual(['getGenesisHash','getAccountInfo']);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({result:'wrong-genesis'}))));
    await expect(readMint(mint)).rejects.toThrow('Wrong network');
  });
});

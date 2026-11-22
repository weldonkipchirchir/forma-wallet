import { describe, expect, it, vi } from 'vitest';
import { Wallet } from 'ethers';
import { evmNetworks } from './evm-networks';
import { listedMainnetTokens, listedMainnetToken, mergeListedTokens } from './mainnet-tokens';
import { evmTokenKey, evmJournalKey } from './evm-assets';
import { assertSignedMatchesReview } from './transfer-safety';
import { maximumEvmFee, verifyEvmTokenTransfer } from './evm-workspace';
import { tokenInterface } from './token-data';
import { isMainnetNetwork } from './network-context';

describe('EVM mainnet identity and signing',()=>{
  it('separates mainnet and testnet data and does not trust symbol-only identity',()=>{
    const owner='0x'+'11'.repeat(20);
    expect(evmTokenKey('base-mainnet',owner)).not.toBe(evmTokenKey('base',owner));
    expect(evmJournalKey('ethereum-mainnet',owner)).not.toBe(evmJournalKey('arbitrum-mainnet',owner));
    expect(isMainnetNetwork('ethereum-mainnet')).toBe(true);expect(isMainnetNetwork('base')).toBe(false);
    expect(listedMainnetTokens('base')).toEqual([]);
    const listed=listedMainnetTokens('ethereum-mainnet');expect(listed.map(t=>t.symbol)).toEqual(['USDC','USDT']);
    const forged={...listed[0],symbol:'FAKE',decimals:18,name:'Forged'};
    expect(mergeListedTokens('ethereum-mainnet',[forged])[0].decimals).toBe(6);
    expect(listedMainnetToken('base-mainnet',listed[0].address)).toBeUndefined();
    expect(listedMainnetTokens('bnb-mainnet')).toEqual([]); // No counterfeit issuer-native USDT label for bridged BSC assets.
  });
  it('binds legacy BNB signed bytes to the exact review, fees, nonce and chain',async()=>{
    const wallet=Wallet.createRandom(),chain=evmNetworks['bnb-mainnet'];
    const review={chainId:BigInt(chain.chainId),type:chain.transactionType,to:'0x'+'22'.repeat(20),nonce:0,value:1n,gasLimit:21000n,gasPrice:1000000000n};
    const raw=await wallet.signTransaction(review);expect(()=>assertSignedMatchesReview(raw,review,wallet.address,56n)).not.toThrow();
    for(const changed of [{...review,gasPrice:2n},{...review,nonce:1},{...review,type:2},{...review,value:2n}])expect(()=>assertSignedMatchesReview(raw,changed,wallet.address,56n)).toThrow();
    expect(()=>assertSignedMatchesReview(raw,review,wallet.address,1n)).toThrow();expect(maximumEvmFee(review)).toBe(21000000000000n);
  });
  it('supports legacy empty-return USDT but rejects recipient or false-return changes',async()=>{
    const token=listedMainnetTokens('ethereum-mainnet').find(t=>t.symbol==='USDT')!,owner='0x'+'11'.repeat(20),to='0x'+'22'.repeat(20);
    const tx={to:token.address,value:0n,data:tokenInterface.encodeFunctionData('transfer',[to,100n])};
    const provider={getCode:vi.fn(async()=> '0x6000'),call:vi.fn(async(request:any)=>{const method=tokenInterface.parseTransaction({data:request.data})!.name;return method==='transfer'?'0x':tokenInterface.encodeFunctionResult(method,[method==='decimals'?6:1000n]);})};
    await expect(verifyEvmTokenTransfer(provider,owner,token,100n,tx,to)).resolves.toBeUndefined();
    await expect(verifyEvmTokenTransfer(provider,owner,token,100n,tx,owner)).rejects.toThrow('recipient');
    provider.call.mockImplementation(async(request:any)=>{const method=tokenInterface.parseTransaction({data:request.data})!.name;return tokenInterface.encodeFunctionResult(method,[method==='transfer'?false:method==='decimals'?6:1000n]);});
    await expect(verifyEvmTokenTransfer(provider,owner,token,100n,tx,to)).rejects.toThrow('returned false');
  });
});

import {describe,it,expect,vi} from 'vitest';
import {AbiCoder,Wallet} from 'ethers';
import {prepareStableSwap,revalidateStableSwap,validateStableReview,STABLE_ASSETS,SWAP_ROUTER,SWAP_FACTORY,SWAP_QUOTER,swapInterface,type SwapReadApi} from './stable-swap';
import {tokenInterface} from './token-data';
import {assertSignedMatchesReview} from './transfer-safety';
const wallet=new Wallet('0x'+'11'.repeat(32)),abi=AbiCoder.defaultAbiCoder();
function fixture(){
  const state={chain:1n,balance:10_000_000n,allowance:1_000_000n,quote:1_000_000n,simulation:1_000_000n,pending:7,mined:7,gas:100000n,eth:10n**18n,decimals:6,code:'0x6000'};
  const api={getNetwork:vi.fn(async()=>({chainId:state.chain})),getCode:vi.fn(async()=>state.code),getTransactionCount:vi.fn(async(_owner:string,block:string)=>block==='pending'?state.pending:state.mined),getFeeData:vi.fn(async()=>({maxFeePerGas:2_000_000_000n,maxPriorityFeePerGas:1_000_000_000n})),estimateGas:vi.fn(async()=>state.gas),getBalance:vi.fn(async()=>state.eth),call:vi.fn(async(tx:any)=>{
    if(tx.to===SWAP_QUOTER)return abi.encode(['uint256','uint160','uint32','uint256'],[state.quote,0,0,100000]);
    if(tx.to===SWAP_FACTORY)return abi.encode(['address'],['0x'+'33'.repeat(20)]);
    if(tx.to===SWAP_ROUTER)return abi.encode(['uint256'],[state.simulation]);
    const name=tokenInterface.parseTransaction({data:tx.data})!.name;
    return name==='decimals'?abi.encode(['uint8'],[state.decimals]):name==='balanceOf'?abi.encode(['uint256'],[state.balance]):name==='allowance'?abi.encode(['uint256'],[state.allowance]):abi.encode(['bool'],[true]);
  })};return{state,api:api as unknown as SwapReadApi,raw:api};
}
describe('direct Ethereum stablecoin swaps',()=>{
  it('binds exact input/output, minimum received, recipient and deadline to the reviewed router call',async()=>{
    const {api}=fixture(),r=await prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{});
    expect(r.stage).toBe('swap');const args=swapInterface.decodeFunctionData('exactInputSingle',r.tx.data!)[0];
    expect(args.tokenIn).toBe(STABLE_ASSETS.USDT);expect(args.tokenOut).toBe(STABLE_ASSETS.USDC);expect(args.recipient).toBe(wallet.address);expect(args.amountIn).toBe(1000000n);expect(args.amountOutMinimum).toBe(995000n);expect(args.fee).toBe(500n);expect(args.deadline).toBe(BigInt(r.deadline));expect(r.tx.value).toBe(0n);
    await expect(revalidateStableSwap(api,r,wallet.address,()=>{})).resolves.toBeUndefined();
    const raw=await wallet.signTransaction(r.tx);expect(()=>assertSignedMatchesReview(raw,r.tx,wallet.address,1n)).not.toThrow();
  });
  it('uses separately reviewed zero-reset and finite exact-amount approvals, never unlimited approval',async()=>{
    const {api,state}=fixture();state.allowance=1n;let r=await prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{});expect(r.stage).toBe('reset');expect(r.tx.to).toBe(STABLE_ASSETS.USDT);expect(tokenInterface.decodeFunctionData('approve',r.tx.data!)).toEqual([SWAP_ROUTER,0n]);
    state.allowance=0n;r=await prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{});expect(r.stage).toBe('approve');expect(tokenInterface.decodeFunctionData('approve',r.tx.data!)).toEqual([SWAP_ROUTER,1000000n]);
  });
  it('rejects stale or tampered recipients, amounts, calldata, chain, fee caps and delegation',async()=>{
    const {api}=fixture(),r=await prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{});
    for(const changed of [{...r,minimum:0n},{...r,owner:'0x'+'44'.repeat(20)},{...r,tx:{...r.tx,to:STABLE_ASSETS.USDT}},{...r,tx:{...r.tx,value:1n}},{...r,tx:{...r.tx,data:'0x'}},{...r,tx:{...r.tx,chainId:56n}},{...r,tx:{...r.tx,gasLimit:500001n}},{...r,tx:{...r.tx,maxFeePerGas:10n**18n}},{...r,tx:{...r.tx,authorizationList:[]}}])expect(()=>validateStableReview(changed,wallet.address)).toThrow();
    expect(()=>validateStableReview(r,wallet.address,r.created+60001)).toThrow('expired');
  });
  it('blocks changed balances/allowances/nonces and quotes or simulations below the minimum',async()=>{
    for(const change of ['allowance','balance','nonce','quote','simulation'] as const){const {api,state}=fixture(),r=await prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{});if(change==='allowance')state.allowance=0n;if(change==='balance')state.balance=0n;if(change==='nonce')state.pending++;if(change==='quote')state.quote=1n;if(change==='simulation')state.simulation=1n;await expect(revalidateStableSwap(api,r,wallet.address,()=>{})).rejects.toThrow();}
  });
  it('fails closed on wrong network, unavailable contracts, changed decimals, pending transactions and insufficient ETH',async()=>{
    for(const change of ['chain','code','decimals','pending','eth'] as const){const {api,state}=fixture();if(change==='chain')state.chain=56n;if(change==='code')state.code='0x';if(change==='decimals')state.decimals=18;if(change==='pending')state.pending++;if(change==='eth')state.eth=0n;await expect(prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{})).rejects.toThrow();}
    const {api}=fixture();await expect(prepareStableSwap(api,wallet.address,'USDT','USDT','1',50,()=>{})).rejects.toThrow();await expect(prepareStableSwap(api,wallet.address,'USDT','USDC','1',5000,()=>{})).rejects.toThrow();await expect(prepareStableSwap(api,wallet.address,'USDT','USDC','1',50,()=>{throw Error('locked');})).rejects.toThrow('locked');
  });
});

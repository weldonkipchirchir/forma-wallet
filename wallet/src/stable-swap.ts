import {Interface,getAddress,ZeroAddress,type JsonRpcProvider,type TransactionRequest} from 'ethers';
import {tokenAmount,tokenInterface} from './token-data';

// Ethereum deployments reviewed against Uniswap's deployment list and issuer contract lists.
export const SWAP_ROUTER='0xE592427A0AEce92De3Edee1F18E0157C05861564';
export const SWAP_FACTORY='0x1F98431c8aD98523631AE4a59f267346ea31F984';
export const SWAP_QUOTER='0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
export const STABLE_ASSETS=Object.freeze({USDT:'0xdAC17F958D2ee523a2206206994597C13D831ec7',USDC:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'});
export type StableSymbol=keyof typeof STABLE_ASSETS;
export const swapInterface=new Interface(['function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)']);
const quoterInterface=new Interface(['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)']);
const factoryInterface=new Interface(['function getPool(address,address,uint24) view returns (address)']);
export type SwapReadApi=Pick<JsonRpcProvider,'getNetwork'|'getCode'|'call'|'estimateGas'|'getFeeData'|'getBalance'|'getTransactionCount'>;
export type StableReview=Readonly<{stage:'reset'|'approve'|'swap';input:StableSymbol;output:StableSymbol;owner:string;amount:bigint;quoted:bigint;minimum:bigint;allowance:bigint;slippage:number;created:number;deadline:number;tx:Readonly<TransactionRequest>}>;
const FEE=500;
const fail=(message:string):never=>{throw Error(message);};
function symbols(input:string,output:string):asserts input is StableSymbol{if(!Object.hasOwn(STABLE_ASSETS,input)||!Object.hasOwn(STABLE_ASSETS,output)||input===output)fail('Only Ethereum USDT to USDC, or USDC to USDT, is supported.');}
function dataFor(review:Pick<StableReview,'stage'|'input'|'output'|'owner'|'amount'|'minimum'|'deadline'>){return review.stage==='swap'?swapInterface.encodeFunctionData('exactInputSingle',[[STABLE_ASSETS[review.input],STABLE_ASSETS[review.output],FEE,review.owner,review.deadline,review.amount,review.minimum,0]]):tokenInterface.encodeFunctionData('approve',[SWAP_ROUTER,review.stage==='reset'?0n:review.amount]);}
async function read(api:SwapReadApi,to:string,data:string,owner:string){return api.call({to,data,from:owner,value:0n});}
async function context(api:SwapReadApi,owner:string,input:StableSymbol,output:StableSymbol,guard:()=>void){
  if((await api.getNetwork()).chainId!==1n)fail('Wrong network. Direct swaps require Ethereum.');guard();
  for(const address of [STABLE_ASSETS[input],STABLE_ASSETS[output],SWAP_ROUTER,SWAP_QUOTER,SWAP_FACTORY]){if(await api.getCode(address)==='0x')fail('A reviewed swap contract is unavailable.');guard();}
  for(const address of [STABLE_ASSETS[input],STABLE_ASSETS[output]]){if(BigInt(tokenInterface.decodeFunctionResult('decimals',await read(api,address,tokenInterface.encodeFunctionData('decimals'),owner))[0])!==6n)fail('Stablecoin decimals changed. Swap blocked.');guard();}
  const pool=getAddress(factoryInterface.decodeFunctionResult('getPool',await read(api,SWAP_FACTORY,factoryInterface.encodeFunctionData('getPool',[STABLE_ASSETS[input],STABLE_ASSETS[output],FEE]),owner))[0]);guard();
  if(pool===ZeroAddress||await api.getCode(pool)==='0x')fail('The reviewed USDT/USDC fee-tier pool is unavailable.');guard();
  const balance=BigInt(tokenInterface.decodeFunctionResult('balanceOf',await read(api,STABLE_ASSETS[input],tokenInterface.encodeFunctionData('balanceOf',[owner]),owner))[0]);guard();
  const allowance=BigInt(tokenInterface.decodeFunctionResult('allowance',await read(api,STABLE_ASSETS[input],tokenInterface.encodeFunctionData('allowance',[owner,SWAP_ROUTER]),owner))[0]);guard();return{balance,allowance};
}
async function quote(api:SwapReadApi,owner:string,input:StableSymbol,output:StableSymbol,amount:bigint){return BigInt(quoterInterface.decodeFunctionResult('quoteExactInputSingle',await read(api,SWAP_QUOTER,quoterInterface.encodeFunctionData('quoteExactInputSingle',[[STABLE_ASSETS[input],STABLE_ASSETS[output],amount,FEE,0]]),owner))[0]);}
export function validateStableReview(review:StableReview,owner:string,now=Date.now()){
  symbols(review.input,review.output);const tx=review.tx;
  if(!['reset','approve','swap'].includes(review.stage)||getAddress(review.owner)!==getAddress(owner)||!Number.isFinite(review.created)||now<review.created||now-review.created>60000||review.deadline!==Math.floor(review.created/1000)+120||!Number.isInteger(review.slippage)||![10,50,100].includes(review.slippage)||review.amount<=0n||review.amount>1_000_000n*1_000_000n||review.quoted<=0n||review.minimum!==review.quoted*BigInt(10000-review.slippage)/10000n||review.minimum<=0n)fail('Swap review expired or changed. Request a new review.');
  const expectedTo=review.stage==='swap'?SWAP_ROUTER:STABLE_ASSETS[review.input];
  if(BigInt(tx.chainId??0)!==1n||tx.type!==2||BigInt(tx.value??0)!==0n||getAddress(String(tx.to))!==getAddress(expectedTo)||tx.data!==dataFor(review)||!Number.isSafeInteger(tx.nonce)||Number(tx.nonce)<0||BigInt(tx.gasLimit??0)<=0n||BigInt(tx.gasLimit??0)>500000n||BigInt(tx.maxFeePerGas??0)<=0n||BigInt(tx.maxPriorityFeePerGas??-1)<0n||BigInt(tx.maxPriorityFeePerGas??0)>BigInt(tx.maxFeePerGas??0)||BigInt(tx.gasLimit!)*BigInt(tx.maxFeePerGas!)>20_000_000_000_000_000n||(tx.accessList!=null&&(tx.accessList as unknown[]).length!==0)||tx.authorizationList!=null)fail('Swap transaction differs from its review.');
  if((review.stage==='reset'&&review.allowance===0n)||(review.stage==='approve'&&review.allowance!==0n)||(review.stage==='swap'&&review.allowance<review.amount))fail('Approval state differs from the reviewed step.');
}
export async function prepareStableSwap(api:SwapReadApi,owner:string,input:string,output:string,text:string,slippage:number,guard:()=>void,now=Date.now()):Promise<StableReview>{
  symbols(input,output);if(![10,50,100].includes(slippage))fail('Choose a supported slippage limit.');owner=getAddress(owner);const destination=output as StableSymbol,amount=tokenAmount(text,6);if(amount>1_000_000n*1_000_000n)fail('The initial swap limit is 1,000,000 tokens.');guard();
  const state=await context(api,owner,input,destination,guard);if(state.balance<amount)fail(`Insufficient ${input} balance.`);
  const quoted=await quote(api,owner,input,destination,amount);guard();if(quoted<=0n)fail('No positive quote is available.');const minimum=quoted*BigInt(10000-slippage)/10000n;if(minimum<=0n)fail('Output is below the supported precision.');
  const stage=state.allowance>=amount?'swap':state.allowance>0n?'reset':'approve',deadline=Math.floor(now/1000)+120;
  const pending=await api.getTransactionCount(owner,'pending'),mined=await api.getTransactionCount(owner,'latest');guard();if(pending!==mined)fail('Another Ethereum transaction is pending. Wait for confirmation first.');
  const tx:TransactionRequest={to:stage==='swap'?SWAP_ROUTER:STABLE_ASSETS[input],data:dataFor({stage,input,output:destination,owner,amount,minimum,deadline}),value:0n,chainId:1n,type:2,nonce:pending};
  const gas=await api.estimateGas({...tx,from:owner}),fees=await api.getFeeData();guard();if(fees.maxFeePerGas==null||fees.maxPriorityFeePerGas==null)fail('Network fee data is unavailable.');tx.gasLimit=gas+gas/5n;tx.maxFeePerGas=fees.maxFeePerGas;tx.maxPriorityFeePerGas=fees.maxPriorityFeePerGas;
  if(await api.getBalance(owner,'pending')<BigInt(tx.gasLimit)*BigInt(tx.maxFeePerGas!))fail('Keep enough ETH for the maximum network fee. USDT cannot pay this fee.');guard();
  const review=Object.freeze({stage,input,output:destination,owner,amount,quoted,minimum,allowance:state.allowance,slippage,created:now,deadline,tx:Object.freeze(tx)});validateStableReview(review,owner,now);return review;
}
export async function revalidateStableSwap(api:SwapReadApi,review:StableReview,owner:string,guard:()=>void){
  validateStableReview(review,owner);guard();const state=await context(api,owner,review.input,review.output,guard);if(state.balance<review.amount||state.allowance!==review.allowance)fail('Token balance or approval changed. Review again.');
  if(await api.getTransactionCount(owner,'pending')!==review.tx.nonce||await api.getTransactionCount(owner,'latest')!==review.tx.nonce)fail('Account nonce changed. Review again.');guard();
  if(review.stage==='swap'&&await quote(api,owner,review.input,review.output,review.amount)<review.minimum)fail('Quote moved below the reviewed minimum. Review again.');guard();
  const result=await api.call({...review.tx,from:owner});guard();
  if(review.stage==='swap'){if(BigInt(swapInterface.decodeFunctionResult('exactInputSingle',result)[0])<review.minimum)fail('Swap simulation received less than the reviewed minimum.');}
  else if(result!=='0x'&&!tokenInterface.decodeFunctionResult('approve',result)[0])fail('Approval simulation failed.');
  if(await api.estimateGas({...review.tx,from:owner})>BigInt(review.tx.gasLimit!))fail('Gas estimate increased. Review again.');guard();
  if(await api.getBalance(owner,'pending')<BigInt(review.tx.gasLimit!)*BigInt(review.tx.maxFeePerGas!))fail('Insufficient ETH for the reviewed maximum network fee.');guard();validateStableReview(review,owner);
}

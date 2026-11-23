import {Interface,getAddress,type TransactionRequest} from 'ethers';
import {bridgeRequest} from '../server/bridge-policy.mjs';
import {evmNetworks,type EvmNetworkId} from './evm-networks';
import type {SwapReadApi} from './stable-swap';
import {verifyRelayQuote,verifyRelayCode,RELAY_OWNER,RELAY_ALLOCATOR,type RelayInput,type RelayVerified} from './relay-bridge';
const admin=new Interface(['function owner() view returns(address)','function allocator() view returns(address)']);
export type BridgeReview=Readonly<{input:RelayInput;quote:any;metadata:any;verified:RelayVerified;created:number;tx:Readonly<TransactionRequest>}>;
const FEE_CAP=50_000_000_000_000_000n;
export function bridgeFee(tx:TransactionRequest){return BigInt(tx.gasLimit??0)*BigInt(tx.type===0?tx.gasPrice??0:tx.maxFeePerGas??0);}
export function validateBridgeReview(review:BridgeReview,owner:string,now=Date.now()){
  if(!Number.isFinite(review.created)||now<review.created||now-review.created>60000||getAddress(owner)!==getAddress(review.input.user))throw Error('Bridge review changed or expired. Request a fresh quote.');
  const request=bridgeRequest(review.input),verified=verifyRelayQuote(review.quote,review.input,review.metadata,now),tx=review.tx,config=evmNetworks[request.from.id as EvmNetworkId];
  if(Object.keys(verified).some(key=>verified[key as keyof RelayVerified]!==review.verified[key as keyof RelayVerified]))throw Error('Bridge review details changed.');
  if(tx.to!==verified.depository||tx.data!==verified.data||BigInt(tx.value??0)!==verified.value||BigInt(tx.chainId??0)!==BigInt(config.chainId)||tx.type!==config.transactionType||!Number.isSafeInteger(tx.nonce)||Number(tx.nonce)<0||BigInt(tx.gasLimit??0)<=0n||BigInt(tx.gasLimit??0)>500000n||bridgeFee(tx)>FEE_CAP||tx.accessList!=null||tx.authorizationList!=null||tx.from!=null||tx.customData!=null)throw Error('Bridge transaction differs from the reviewed order.');
  if(tx.type===0){if(BigInt(tx.gasPrice??0)<=0n||tx.maxFeePerGas!=null||tx.maxPriorityFeePerGas!=null)throw Error('Invalid bridge fee.');}
  else if(BigInt(tx.maxFeePerGas??0)<=0n||BigInt(tx.maxPriorityFeePerGas??-1)<0n||BigInt(tx.maxPriorityFeePerGas??0)>BigInt(tx.maxFeePerGas??0)||tx.gasPrice!=null)throw Error('Invalid bridge fee.');
  return verified;
}
async function context(api:SwapReadApi,input:RelayInput,verified:RelayVerified,guard:()=>void){
  const request=bridgeRequest(input);if((await api.getNetwork()).chainId!==BigInt(request.from.chainId))throw Error('Wrong source network.');guard();
  verifyRelayCode(await api.getCode(verified.depository),verified.depository,request.from.chainId);guard();
  for(const [field,expected] of [['owner',RELAY_OWNER],['allocator',RELAY_ALLOCATOR]]){const data=await api.call({to:verified.depository,data:admin.encodeFunctionData(field)});guard();if(getAddress(admin.decodeFunctionResult(field,data)[0])!==getAddress(expected))throw Error('Bridge contract administration changed. Sending blocked.');}
}
export async function prepareBridge(api:SwapReadApi,input:RelayInput,quote:any,metadata:any,guard:()=>void):Promise<BridgeReview>{
  const request=bridgeRequest(input),verified=verifyRelayQuote(quote,input,metadata),config=evmNetworks[request.from.id as EvmNetworkId];guard();await context(api,input,verified,guard);
  const pending=await api.getTransactionCount(request.user,'pending'),latest=await api.getTransactionCount(request.user,'latest');guard();if(pending!==latest)throw Error('Wait for pending source transactions to confirm.');
  const tx:TransactionRequest={chainId:config.chainId,to:verified.depository,data:verified.data,value:verified.value,nonce:pending,type:config.transactionType};
  await api.call({...tx,from:request.user});guard();const gas=await api.estimateGas({...tx,from:request.user}),fees=await api.getFeeData();guard();tx.gasLimit=gas+gas/5n;
  if(tx.type===0)tx.gasPrice=fees.gasPrice;else{tx.maxFeePerGas=fees.maxFeePerGas;tx.maxPriorityFeePerGas=fees.maxPriorityFeePerGas;}
  // Copy provider JSON so later mutations of its response cannot alter a review.
  const review=Object.freeze({input:Object.freeze({...input}),quote:JSON.parse(JSON.stringify(quote)),metadata:JSON.parse(JSON.stringify(metadata)),verified:Object.freeze(verified),created:Date.now(),tx:Object.freeze(tx)});
  validateBridgeReview(review,request.user);if(await api.getBalance(request.user,'pending')<verified.value+bridgeFee(tx))throw Error('Insufficient native balance for the deposit and maximum execution fee.');guard();return review;
}
export async function revalidateBridge(api:SwapReadApi,review:BridgeReview,owner:string,guard:()=>void){
  const verified=validateBridgeReview(review,owner);guard();await context(api,review.input,verified,guard);if(await api.getTransactionCount(owner,'pending')!==review.tx.nonce||await api.getTransactionCount(owner,'latest')!==review.tx.nonce)throw Error('Account nonce changed. Review again.');guard();
  await api.call({...review.tx,from:owner});guard();if(await api.estimateGas({...review.tx,from:owner})>BigInt(review.tx.gasLimit!))throw Error('Bridge gas estimate increased. Review again.');if(await api.getBalance(owner,'pending')<verified.value+bridgeFee(review.tx))throw Error('Source balance changed. Review again.');guard();validateBridgeReview(review,owner);
}

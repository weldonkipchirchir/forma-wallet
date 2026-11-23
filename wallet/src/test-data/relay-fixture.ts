import {Wallet,ZeroAddress,getBytes,toBeHex} from 'ethers';
import {BRIDGE_NETWORKS,bridgeNetwork,bridgeRequest} from '../../server/bridge-policy.mjs';
import {verifyRelayQuote,relayOrderHash,relayDeposit,verifyRelayCode,relayAddress} from '../relay-bridge';
import runtime from './relay-runtime.json';
import {bech32} from '@scure/base';
// Published, synthetic test identity; never fund it.
export const solver=new Wallet(toBeHex(1,32)),owner=new Wallet(toBeHex(2,32)).address,other=new Wallet(toBeHex(3,32)).address;
export const depository=runtime[0].address,now=1795440000000;
export async function fixture(to='base-mainnet',at=now){
  const from=bridgeNetwork('ethereum-mainnet'),destination=bridgeNetwork(to),recipient=to==='sol-mainnet'?'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB':to==='btc-mainnet'?bech32.encode('bc',[0,...bech32.toWords(new Uint8Array(20).fill(1))]):owner;
  const input={from:from.id,to,amount:'10000000000000000',user:owner,recipient};
  const metadata={chains:[from,destination].map(network=>({id:network.chainId,vmType:network.vm,protocol:{v2:{chainId:network.protocol,depository}}}))};
  const order:any={version:'v1',solverChainId:'ethereum',solver:solver.address,salt:toBeHex(4,32),inputs:[{payment:{chainId:'ethereum',currency:ZeroAddress,amount:input.amount,weight:'1'},refunds:[{chainId:'ethereum',recipient:owner,currency:ZeroAddress,minimumAmount:input.amount,deadline:Math.floor(at/1000)+3600,extraData:'0x'}]}],output:{chainId:destination.protocol,payments:[{recipient,currency:destination.native,minimumAmount:'995',expectedAmount:'1000'}],deadline:Math.floor(at/1000)+120,calls:[],extraData:'0x'},fees:[]};
  const orderId=relayOrderHash(order,from,destination),signature=await solver.signMessage(getBytes(orderId));
  const quote:any={protocol:{v2:{hubType:'onchain',orderData:order,orderId,orderSignature:signature,paymentDetails:{depository,chainId:'ethereum',currency:ZeroAddress,amount:input.amount}}},steps:[{kind:'transaction',requestId:toBeHex(5,32),items:[{data:{from:owner,to:depository,chainId:1,value:input.amount,data:relayDeposit.encodeFunctionData('depositNative',[owner,orderId])}}]}]};
  return{input,metadata,quote};
}

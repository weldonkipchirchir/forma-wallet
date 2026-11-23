import {describe,it,expect} from 'vitest';
import {Wallet,ZeroAddress,getBytes,toBeHex} from 'ethers';
import {BRIDGE_NETWORKS,bridgeNetwork,bridgeRequest} from '../server/bridge-policy.mjs';
import {verifyRelayQuote,relayOrderHash,relayDeposit,verifyRelayCode,relayAddress} from './relay-bridge';
import runtime from './test-data/relay-runtime.json';
import {bech32} from '@scure/base';
// Published, synthetic test identity; never fund it.
const solver=new Wallet(toBeHex(1,32)),owner=new Wallet(toBeHex(2,32)).address,other=new Wallet(toBeHex(3,32)).address;
const depository=runtime[0].address,now=1795440000000;
async function fixture(to='base-mainnet'){
  const from=bridgeNetwork('ethereum-mainnet'),destination=bridgeNetwork(to),recipient=to==='sol-mainnet'?'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB':to==='btc-mainnet'?bech32.encode('bc',[0,...bech32.toWords(new Uint8Array(20).fill(1))]):owner;
  const input={from:from.id,to,amount:'10000000000000000',user:owner,recipient};
  const metadata={chains:[from,destination].map(network=>({id:network.chainId,vmType:network.vm,protocol:{v2:{chainId:`chain-${network.chainId}`,depository}}}))};
  const order:any={version:'v1',solverChainId:'ethereum',solver:solver.address,salt:toBeHex(4,32),inputs:[{payment:{chainId:'chain-1',currency:ZeroAddress,amount:input.amount,weight:'1'},refunds:[{chainId:'chain-1',recipient:owner,currency:ZeroAddress,minimumAmount:input.amount,deadline:now/1000+3600,extraData:'0x'}]}],output:{chainId:`chain-${destination.chainId}`,payments:[{recipient,currency:destination.native,minimumAmount:'995',expectedAmount:'1000'}],deadline:now/1000+120,calls:[],extraData:'0x'},fees:[]};
  const orderId=relayOrderHash(order,from,destination),signature=await solver.signMessage(getBytes(orderId));
  const quote:any={protocol:{v2:{hubType:'onchain',orderData:order,orderId,orderSignature:signature,paymentDetails:{depository,chainId:'chain-1',currency:ZeroAddress,amount:input.amount}}},steps:[{kind:'transaction',requestId:toBeHex(5,32),items:[{data:{from:owner,to:depository,chainId:1,value:input.amount,data:relayDeposit.encodeFunctionData('depositNative',[owner,orderId])}}]}]};
  return{input,metadata,quote};
}
describe('Relay quote preparation boundary',()=>{
  it.each(['base-mainnet','sol-mainnet','btc-mainnet'])('verifies an independently signed synthetic order to %s',async to=>{
    const f=await fixture(to),result=verifyRelayQuote(f.quote,f.input,f.metadata,now,solver.address);expect(result.value).toBe(10000000000000000n);expect(result.minimum).toBe(995n);
    expect(()=>verifyRelayQuote(f.quote,f.input,f.metadata,now)).toThrow(); // synthetic solver never passes production pin
  });
  it.each(['recipient','amount','output','signature','calls','extraData','refund','depository','transaction','steps','expiry','version','metadata'])('rejects tampered %s',async change=>{
    const f=await fixture(),v=f.quote.protocol.v2;
    if(change==='recipient')v.orderData.output.payments[0].recipient=other;
    if(change==='amount')v.orderData.inputs[0].payment.amount='1';
    if(change==='output')v.orderData.output.payments[0].minimumAmount='1';
    if(change==='signature')v.orderSignature=toBeHex(0,65);
    if(change==='calls')v.orderData.output.calls=['0x12'];
    if(change==='extraData')v.orderData.output.extraData='0x12';
    if(change==='refund')v.orderData.inputs[0].refunds[0].recipient=other;
    if(change==='depository')f.metadata.chains[0].protocol.v2.depository=other;
    if(change==='transaction')f.quote.steps[0].items[0].data.value='2';
    if(change==='steps')f.quote.steps.push(f.quote.steps[0]);
    if(change==='expiry')v.orderData.output.deadline=now/1000;
    if(change==='version')v.orderData.version='v2';
    if(change==='metadata')f.metadata.chains.push(f.metadata.chains[0]);
    expect(()=>verifyRelayQuote(f.quote,f.input,f.metadata,now,solver.address)).toThrow();
  });
  it('rejects unsupported inputs, arbitrary properties, wrong chains and invalid recipients',()=>{
    const f={from:'ethereum-mainnet',to:'base-mainnet',amount:'10',user:owner,recipient:owner};expect(bridgeRequest(f).from.chainId).toBe(1);
    for(const bad of [{...f,from:'sol-mainnet'},{...f,to:f.from},{...f,url:'http://127.0.0.1'},{...f,recipient:ZeroAddress},{...f,amount:'-1'},{...f,amount:1},{...f,to:'tron-mainnet'}])expect(()=>bridgeRequest(bad)).toThrow();
    expect(BRIDGE_NETWORKS).toHaveLength(18);expect(relayAddress('11111111111111111111111111111111',bridgeNetwork('sol-mainnet'))).toBe(toBeHex(0,32));
  });
  it('pins both published runtimes and rejects code or immutable changes',()=>{
    for(const row of runtime){expect(()=>verifyRelayCode(row.code,row.address,1)).not.toThrow();const bytes=getBytes(row.code);bytes[0]^=1;expect(()=>verifyRelayCode(bytesToHex(bytes),row.address,1)).toThrow();}
    const bytes=getBytes(runtime[0].code);bytes[8292+31]=1;expect(()=>verifyRelayCode(bytesToHex(bytes),runtime[0].address,1)).toThrow('immutable');expect(()=>verifyRelayCode(runtime[0].code,other,1)).toThrow();
  });
});
function bytesToHex(bytes:Uint8Array){return '0x'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');}

import type {TokenSubmission} from './token-journal';
import {bridgeNetwork,validBridgeAddress} from '../server/bridge-policy.mjs';
import {base58} from '@scure/base';
export type BridgeRecord={hash:string;requestId:string;orderId:string;from:string;to:string;amount:string;minimum:string;recipient:string;when:number;provider:string;out:string[];reason?:string};
const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
export const bridgeHistoryKey=(owner:string)=>`forma.bridge.history.v1:${owner.toLowerCase()}`;
export function bridgeRecords(raw:string|null):BridgeRecord[]{
  if(!raw)return[];if(raw.length>150000)throw Error('Bridge records exceed the supported limit.');const data=JSON.parse(raw);if(!Array.isArray(data)||data.length>50)throw Error('Bridge records are damaged. Sending blocked.');const orders=new Set<string>();
  for(const row of data){if(!row||!hash(row.hash)||!hash(row.requestId)||!hash(row.orderId)||orders.has(row.orderId.toLowerCase())||bridgeNetwork(row.from).vm!=='evm'||row.from===row.to||typeof row.amount!=='string'||!/^\d{1,30}$/.test(row.amount)||BigInt(row.amount)<=0n||typeof row.minimum!=='string'||!/^\d{1,78}$/.test(row.minimum)||BigInt(row.minimum)<=0n||typeof row.recipient!=='string'||row.recipient.length>100||!Number.isSafeInteger(row.when)||row.when<=0||!['unknown','waiting','depositing','pending','submitted','success','failure','refund'].includes(row.provider)||!Array.isArray(row.out)||row.out.length>8||!row.out.every((value:unknown)=>outHash(value,bridgeNetwork(row.provider==='refund'?row.from:row.to).vm))||(row.reason!==undefined&&(typeof row.reason!=='string'||!/^[A-Z0-9_]{1,100}$/.test(row.reason))))throw Error('Bridge records are invalid. Sending blocked.');validBridgeAddress(row.recipient,bridgeNetwork(row.to).vm);orders.add(row.orderId.toLowerCase());}
  return data;
}
function outHash(value:unknown,vm:string){if(vm==='evm')return hash(value);if(vm==='bvm')return typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value);try{return typeof value==='string'&&value.length<=90&&base58.decode(value).length===64;}catch{return false;}}
export function updateBridgeStatus(row:BridgeRecord,data:any):BridgeRecord{
  const from=bridgeNetwork(row.from),to=bridgeNetwork(row.to);if(!data||data.originChainId!==from.chainId||data.destinationChainId!==to.chainId||!Array.isArray(data.inTxHashes)||!data.inTxHashes.some((value:unknown)=>typeof value==='string'&&value.toLowerCase()===row.hash.toLowerCase())||!['waiting','depositing','pending','submitted','success','failure','refund'].includes(data.status))throw Error('Provider status does not match this bridge deposit.');
  const out=data.txHashes??[];if(!Array.isArray(out)||out.length>8||!out.every((value:unknown)=>outHash(value,data.status==='refund'?from.vm:to.vm))||(['success','refund'].includes(data.status)&&out.length===0))throw Error('Settlement transaction details are missing or invalid.');
  const reason=data.refundFailReason||data.failReason;const updated={...row,provider:data.status,out,...(typeof reason==='string'&&/^[A-Z0-9_]{1,100}$/.test(reason)?{reason}:{reason:undefined})};bridgeRecords(JSON.stringify([updated]));return updated;
}
export function requireBridgeSettled(rows:BridgeRecord[],sourceFailed:Set<string>){if(rows.some(row=>!sourceFailed.has(row.hash)&&!(['success','refund'].includes(row.provider)&&row.out.length)))throw Error('An earlier bridge is unresolved. Refresh its source and settlement status before another bridge deposit.');}
export function addBridgeRecord(rows:BridgeRecord[],row:BridgeRecord){if(rows.some(old=>old.orderId.toLowerCase()===row.orderId.toLowerCase()&&old.hash!==row.hash))throw Error('This bridge order was already submitted. Do not deposit twice.');const result=[row,...rows.filter(old=>old.hash!==row.hash)];return bridgeRecords(JSON.stringify(result));}

export function requireBridgeNonce(rows:TokenSubmission[],nonce:number){if(rows.some(row=>['confirmed','failed'].includes(row.status)&&row.nonce!==undefined&&row.nonce>=nonce))throw Error('The RPC nonce is older than a mined local transaction. Refresh source status and do not sign with this nonce.');}

import { boundedText } from './bounded-response';
import { verifyUtxo, btcRecipient, type MultiKeys, type VerifiedUtxo } from './multichain-core';
import { safeNumber } from './multichain-network';
export const BTC_MAINNET_API='https://blockstream.info/api';
export const BTC_MAINNET_GENESIS='000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
export const btcMainnetJournalKey=(owner:string)=>`forma.bitcoin.mainnet.submissions.v1:${btcRecipient(owner,true)}`;
export type BtcMainnetSubmission={id:string;to:string;amount:string;fee:string;when:number;status:'unknown'|'pending'|'confirmed'};
export function btcMainnetJournal(raw:string|null):BtcMainnetSubmission[]{
  if(raw&&raw.length>100000)throw new Error('Bitcoin Mainnet journal too large. Sending blocked.');
  const rows=JSON.parse(raw||'[]');if(!Array.isArray(rows)||rows.length>100)throw new Error('Invalid Bitcoin Mainnet journal.');
  const seen=new Set<string>();
  for(const row of rows){if(!row||typeof row.id!=='string'||!/^[a-f0-9]{64}$/.test(row.id)||seen.has(row.id)||typeof row.to!=='string'||typeof row.amount!=='string'||!/^\d{1,16}$/.test(row.amount)||BigInt(row.amount)<546n||BigInt(row.amount)>2100000000000000n||typeof row.fee!=='string'||!/^\d{1,6}$/.test(row.fee)||BigInt(row.fee)>100000n||!Number.isSafeInteger(row.when)||row.when<=0||!['unknown','pending','confirmed'].includes(row.status))throw new Error('Invalid Bitcoin Mainnet submission. Sending blocked.');btcRecipient(row.to,true);seen.add(row.id);}
  return rows;
}
export function retainBtcMainnet(rows:BtcMainnetSubmission[],next:BtcMainnetSubmission){
  const merged=[next,...rows.filter(row=>row.id!==next.id)],unresolved=merged.filter(row=>row.status!=='confirmed');
  if(unresolved.length>50)throw new Error('Resolve Bitcoin submissions before sending.');
  return btcMainnetJournal(JSON.stringify([...unresolved,...merged.filter(row=>row.status==='confirmed')].slice(0,100)));
}
export function createBitcoinMainnetApi(signal?:AbortSignal){
  async function request(path:string,body?:string){const response=await fetch(BTC_MAINNET_API+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'text/plain'},body}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw new Error('Bitcoin Mainnet service unavailable. Check pending transaction status before retrying.');return boundedText(response,2_000_000);}
  async function identity(){if((await request('/block-height/0')).trim()!==BTC_MAINNET_GENESIS)throw new Error('Wrong Bitcoin network. Mainnet operation blocked.');}
  async function balance(owner:string){btcRecipient(owner,true);await identity();const data=JSON.parse(await request(`/address/${owner}`));const stats=data?.chain_stats;const value=BigInt(safeNumber(stats?.funded_txo_sum))-BigInt(safeNumber(stats?.spent_txo_sum));if(value<0n||value>2100000000000000n)throw new Error('Invalid Bitcoin Mainnet balance.');return value;}
  async function funding(keys:MultiKeys):Promise<VerifiedUtxo[]>{if(!keys.btcMainnet||keys.disposed)throw new Error('Wrong Bitcoin signing account.');btcRecipient(keys.btcAddress,true);await identity();const data=JSON.parse(await request(`/address/${keys.btcAddress}/utxo`));if(!Array.isArray(data)||data.length>2000)throw new Error('Unsupported Bitcoin UTXO response.');const seen=new Set<string>();const rows=data.filter(row=>row?.status?.confirmed===true).slice(0,20);const result:VerifiedUtxo[]=[];for(const row of rows){if(typeof row.txid!=='string'||!/^[a-f0-9]{64}$/.test(row.txid))throw new Error('Invalid funding transaction.');const vout=safeNumber(row.vout),value=BigInt(safeNumber(row.value)),key=`${row.txid}:${vout}`;if(value<=0n||seen.has(key))throw new Error('Duplicate or invalid Bitcoin funding output.');seen.add(key);const raw=(await request(`/tx/${row.txid}/hex`)).trim();if(!/^(?:[a-f0-9]{2})+$/i.test(raw))throw new Error('Invalid previous transaction bytes.');result.push(verifyUtxo(Uint8Array.from(raw.match(/../g)!,v=>parseInt(v,16)),row.txid,vout,value,keys.btcScript));}return result;}
  async function unspent(txid:string,vout:number){if(!/^[a-f0-9]{64}$/.test(txid)||!Number.isSafeInteger(vout)||vout<0)throw new Error('Invalid outpoint.');const data=JSON.parse(await request(`/tx/${txid}/outspend/${vout}`));if(data?.spent!==false)throw new Error('Bitcoin input spent or unavailable. Refresh and review again.');}
  async function status(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid Bitcoin transaction ID.');const data=JSON.parse(await request(`/tx/${id}/status`));return data?.confirmed===true?'confirmed' as const:data?.confirmed===false?'pending' as const:'unknown' as const;}
  async function broadcast(raw:string,expected:string){if(!/^(?:[a-f0-9]{2})+$/i.test(raw)||!/^[a-f0-9]{64}$/.test(expected))throw new Error('Invalid signed Bitcoin bytes.');const id=(await request('/tx',raw)).trim();if(id!==expected)throw new Error('Broadcast response differs. Check the recorded transaction ID.');}
  return {identity,balance,funding,unspent,status,broadcast};
}

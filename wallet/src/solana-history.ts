import {PublicKey} from '@solana/web3.js';
import {base58} from '@scure/base';
import {TOKEN_PROGRAM} from './sol-tokens';
import {listedSolanaMint} from './solana-mainnet';
export type SolHistoryRow={id:string;hash:string;direction:'received'|'sent'|'self'|'activity';symbol:string;amount?:bigint;decimals:number;mint?:string;peer?:string;when?:number;status:'confirmed'|'failed'|'unavailable';kind:'transfer'|'balance-change'|'transaction'};
export type SolHistoryApi={identity():Promise<void>;rpc(method:string,params?:unknown[]):Promise<any>};
export function solSignature(value:unknown):value is string{try{return typeof value==='string'&&value.length<=90&&base58.decode(value).length===64;}catch{return false;}}
const address=(value:unknown)=>typeof value==='string'?new PublicKey(value).toBase58():'';
function units(value:unknown){if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw Error('Unsafe chain amount.');return BigInt(value);}if(typeof value==='string'&&/^\d{1,20}$/.test(value)&&BigInt(value)<=0xffffffffffffffffn)return BigInt(value);throw Error('Invalid chain amount.');}
export function parseSolTransaction(hash:string,owner:string,value:any):SolHistoryRow[]{
  if(!solSignature(hash))throw Error('Invalid transaction signature.');owner=address(owner);
  const when=Number.isSafeInteger(value?.blockTime)&&value.blockTime>0?value.blockTime*1000:undefined;
  const base={hash,when,decimals:9,symbol:'SOL',kind:'transaction' as const,direction:'activity' as const};
  if(!value?.meta||!Array.isArray(value.transaction?.message?.accountKeys))return[{...base,id:hash,status:'unavailable'}];
  const keys=value.transaction.message.accountKeys;if(keys.length>512)throw Error('Transaction account limit exceeded.');
  const signatures=value.transaction.signatures;if(!Array.isArray(signatures)||!signatures.includes(hash))throw Error('Transaction signature mismatch.');
  const accounts=keys.map((key:any)=>address(typeof key==='string'?key:key?.pubkey));if(!accounts.includes(owner)&&![...(value.meta.preTokenBalances||[]),...(value.meta.postTokenBalances||[])].some((token:any)=>token.owner===owner))throw Error('Transaction does not include this wallet.');
  if(!Object.hasOwn(value.meta,'err'))return[{...base,id:hash,status:'unavailable'}];
  if(value.meta.err!==null)return[{...base,id:hash,status:'failed'}];
  const rows:SolHistoryRow[]=[];const outer=value.transaction.message.instructions||[],inner=value.meta.innerInstructions||[];
  if(!Array.isArray(outer)||!Array.isArray(inner)||outer.length>200||inner.length>200)throw Error('Transaction instruction limit exceeded.');
  const instructions=[...outer,...inner.flatMap((group:any)=>Array.isArray(group.instructions)?group.instructions:[])];if(instructions.length>2000)throw Error('Too many transaction instructions.');
  for(const [index,instruction] of instructions.entries()){
    if(instruction?.programId!=='11111111111111111111111111111111'||instruction.parsed?.type!=='transfer')continue;
    const info=instruction.parsed.info;let from:string,to:string,amount:bigint;try{from=address(info.source);to=address(info.destination);amount=units(info.lamports);}catch{continue;}
    if(amount===0n||(from!==owner&&to!==owner)||!accounts.includes(from)||!accounts.includes(to))continue;
    rows.push({...base,id:`${hash}:sol:${index}`,status:'confirmed',direction:from===owner&&to===owner?'self':to===owner?'received':'sent',peer:from===owner?to:from,amount,kind:'transfer'});
  }
  const before=value.meta.preTokenBalances??[],after=value.meta.postTokenBalances??[];if(!Array.isArray(before)||!Array.isArray(after)||before.length>1000||after.length>1000)throw Error('Token history limit exceeded.');
  const totals=new Map<string,{pre:bigint;post:bigint;decimals:number;ambiguous:boolean}>();
  for(const [side,list,other] of [['pre',before,after],['post',after,before]] as const){const seen=new Set<number>();for(const token of list){
    if(token?.owner!==owner)continue;const mint=address(token.mint),decimals=token.uiTokenAmount?.decimals,index=token.accountIndex;
    if(!Number.isInteger(index)||index<0||index>=accounts.length||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid historical token metadata.');
    if(seen.has(index))throw Error('Duplicate historical token account.');seen.add(index);
    let total=totals.get(mint);if(!total){total={pre:0n,post:0n,decimals,ambiguous:false};totals.set(mint,total);}if(total.decimals!==decimals)throw Error('Historical token decimals changed.');
    total[side]+=units(token.uiTokenAmount.amount);if(total[side]>0xffffffffffffffffn)throw Error('Historical token amount too large.');
    if(other.some((candidate:any)=>candidate.accountIndex===index&&candidate.mint===mint&&candidate.owner==null))total.ambiguous=true;
  }}
  for(const [mint,total] of totals){const delta=total.post-total.pre;if(!delta&&!total.ambiguous)continue;const listed=listedSolanaMint(mint);rows.push({...base,id:`${hash}:token:${mint}`,symbol:listed||'SPL',mint,decimals:total.decimals,status:total.ambiguous?'unavailable':'confirmed',direction:total.ambiguous?'activity':delta>0n?'received':'sent',amount:total.ambiguous?undefined:delta<0n?-delta:delta,kind:'balance-change'});}
  if(!rows.some(row=>row.symbol==='SOL')){const index=accounts.indexOf(owner);try{const pre=units(value.meta.preBalances[index]),post=units(value.meta.postBalances[index]),fee=index===0?units(value.meta.fee):0n,delta=post-pre+fee;if(delta)rows.unshift({...base,id:`${hash}:sol:net`,status:'confirmed',direction:delta>0n?'received':'sent',amount:delta<0n?-delta:delta,kind:'balance-change'});}catch{/* Do not turn unsafe or missing lamport data into zero. */}}
  return rows.length?rows:[{...base,id:hash,status:'confirmed'}];
}
export type SolHistoryCursor={addresses:string[];before:Record<string,string>;exhausted:string[]};
export async function loadSolHistory(api:SolHistoryApi,owner:string,current:()=>boolean,cursor?:SolHistoryCursor){
  owner=address(owner);await api.identity();if(!current())throw Error('Wallet changed.');
  let addresses=[owner];
  if(cursor){if(!Array.isArray(cursor.addresses)||cursor.addresses.length>6||cursor.addresses[0]!==owner)throw Error('Invalid history cursor.');addresses=cursor.addresses.map(address);}
  else{try{const accounts=await api.rpc('getTokenAccountsByOwner',[owner,{programId:TOKEN_PROGRAM.toBase58()},{encoding:'jsonParsed',commitment:'confirmed'}]);if(!current())throw Error('Wallet changed.');if(!Array.isArray(accounts?.value)||accounts.value.length>1000)throw Error('Token history discovery unavailable.');addresses.push(...accounts.value.filter((row:any)=>row.account?.owner===TOKEN_PROGRAM.toBase58()&&row.account.data?.parsed?.info?.owner===owner).slice(0,5).map((row:any)=>address(row.pubkey)));}catch{if(!current())throw Error('Wallet changed.');}}
  addresses=[...new Set(addresses)];const before={...cursor?.before},exhausted=new Set(cursor?.exhausted||[]),signatures:any[]=[];
  for(const target of addresses){if(exhausted.has(target))continue;const previous=before[target];if(previous&&!solSignature(previous))throw Error('Invalid history cursor.');if(!current())throw Error('Wallet changed.');
    const page=await api.rpc('getSignaturesForAddress',[target,{limit:5,...(previous?{before:previous}:{})}]);if(!Array.isArray(page)||page.length>5)throw Error('Unexpected history response.');const seen=new Set<string>();for(const row of page){if(!solSignature(row?.signature)||seen.has(row.signature))throw Error('Invalid or duplicate history signature.');seen.add(row.signature);}signatures.push(...page);if(page.length<5)exhausted.add(target);else before[target]=page.at(-1).signature;
  }
  const unique=[...new Map(signatures.map(row=>[row.signature,row])).values()];let next=0;const results:SolHistoryRow[][]=new Array(unique.length);
  await Promise.all(Array.from({length:Math.min(2,unique.length)},async()=>{while(next<unique.length&&current()){const index=next++,item=unique[index];try{const value=await api.rpc('getTransaction',[item.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:0,commitment:'confirmed'}]);if(!current())return;results[index]=parseSolTransaction(item.signature,owner,value);}catch{if(!current())return;results[index]=[{id:item.signature,hash:item.signature,symbol:'SOL',decimals:9,direction:'activity',kind:'transaction',status:'unavailable'}];}}}));
  if(!current())throw Error('Wallet changed.');return{rows:results.flat().sort((a,b)=>(b.when||0)-(a.when||0)),cursor:exhausted.size===addresses.length?undefined:{addresses,before,exhausted:[...exhausted]}};
}

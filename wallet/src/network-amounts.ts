export type Movement = { amount: bigint; decimals: number; asset: 'devSOL'|'tBTC'|'SPL'; direction: 'sent'|'received'|'change'; mint?: string };
const numberAmount = (value: unknown) => { if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0) throw new Error('Invalid transaction amount.'); return BigInt(value); };
const movement = (amount: bigint, decimals: number, asset: Movement['asset'], direction: Movement['direction'], mint?: string): Movement => ({amount,decimals,asset,direction,...(mint?{mint}:{})});
export function bitcoinMovements(tx: any, address: string): Movement[] {
  if(!Array.isArray(tx?.vin)||!Array.isArray(tx?.vout)||tx.vin.length>2000||tx.vout.length>2000) throw new Error('Invalid Bitcoin transaction.');
  let spent=0n,received=0n;
  for(const input of tx.vin) if(input?.prevout?.scriptpubkey_address===address) spent+=numberAmount(input.prevout.value);
  for(const output of tx.vout) if(output?.scriptpubkey_address===address) received+=numberAmount(output.value);
  // A net address change includes fees and may include multiple senders.
  const delta=received-spent;
  return delta ? [movement(delta,8,'tBTC',spent ? 'change':'received')] : [];
}
export function solanaMovements(tx: any, address: string): Movement[] {
  if(!tx?.meta || tx.meta.err!==null || !Array.isArray(tx?.transaction?.message?.instructions)) return [];
  const outer=tx.transaction.message.instructions, inner=tx.meta.innerInstructions ?? [];
  if(outer.length>1000 || !Array.isArray(inner) || inner.length>1000) throw new Error('Unsupported transaction size.');
  let sent=0n,received=0n;
  const instructions=[...outer,...inner.flatMap((group:any)=>Array.isArray(group?.instructions)?group.instructions:[])];
  if(instructions.length>5000) throw new Error('Unsupported instruction count.');
  for(const ix of instructions) {
    if(ix?.programId!=='11111111111111111111111111111111' || !['transfer','transferWithSeed'].includes(ix?.parsed?.type)) continue;
    const info=ix.parsed.info;
    if(info?.source===info?.destination) continue;
    if(info?.source===address) sent+=numberAmount(info.lamports);
    if(info?.destination===address) received+=numberAmount(info.lamports);
  }
  const results: Movement[]=[];
  if(sent || received) results.push(movement(received-sent,9,'devSOL',sent&&received?'change':sent?'sent':'received'));
  const totals=new Map<string,{before:bigint;after:bigint;decimals:number}>();
  for(const [field,side] of [['preTokenBalances','before'],['postTokenBalances','after']] as const) {
    const rows=tx.meta[field] ?? []; if(!Array.isArray(rows)||rows.length>1000) throw new Error('Invalid token balances.');
    const seen=new Set<string>();
    for(const row of rows) {
      if(row?.owner!==address || (row.programId && row.programId!=='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')) continue;
      const value=row.uiTokenAmount, mint=row.mint, id=`${row.accountIndex}:${mint}`;
      if(typeof mint!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!Number.isInteger(value?.decimals)||value.decimals<0||value.decimals>18||typeof value?.amount!=='string'||!/^\d{1,20}$/.test(value.amount)||BigInt(value.amount)>0xffffffffffffffffn||seen.has(id)) throw new Error('Invalid token amount.');
      seen.add(id); const current=totals.get(mint)||{before:0n,after:0n,decimals:value.decimals};
      if(current.decimals!==value.decimals) throw new Error('Inconsistent token decimals.');
      current[side]+=BigInt(value.amount); totals.set(mint,current);
    }
  }
  for(const [mint,row] of totals) { const delta=row.after-row.before; if(delta) results.push(movement(delta,row.decimals,'SPL',delta<0n?'sent':'received',mint)); }
  return results;
}

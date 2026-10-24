import { PublicKey, Transaction, TransactionInstruction, type Blockhash } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { hexlify } from 'ethers';
import { solRecipient, requireSolSigner, type MultiKeys } from './multichain-core';
import { assertTestnet, solRpc } from './multichain-network';
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export type SplMint = { mint: string; decimals: number; freezeAuthority: string | null; mintAuthority: string | null };
export const splKey = (owner: string) => `forma.sol.devnet.mints.v1:${owner}`;
export function splUnits(text: string, decimals: number) {
  if(!Number.isInteger(decimals) || decimals<0 || decimals>18 || text.length>40 || !(decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`)).test(text)) throw new Error('Invalid SPL amount or precision.');
  const [whole,fraction='']=text.split('.'); const value=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(value<=0n || value>0xffffffffffffffffn) throw new Error('SPL amount is outside the u64 range.'); return value;
}
export function parseMints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0,25).filter((v):v is string=>typeof v==='string').flatMap(v=>{try{return [new PublicKey(v).toBase58()];}catch{return [];}}))];
}
export function mintInfo(mint: string, value: any): SplMint {
  const parsed=value?.data?.parsed, info=parsed?.info;
  if (value?.owner !== TOKEN_PROGRAM.toBase58() || parsed?.type !== 'mint' || info?.isInitialized !== true || !Number.isInteger(info.decimals) || info.decimals<0 || info.decimals>18) throw new Error('Only initialized classic SPL mints with 0–18 decimals are supported. Token-2022 is not supported.');
  for (const field of ['mintAuthority','freezeAuthority']) if(info[field] !== null && typeof info[field] !== 'string') throw new Error('Invalid mint authority.');
  return {mint:new PublicKey(mint).toBase58(),decimals:info.decimals,freezeAuthority:info.freezeAuthority,mintAuthority:info.mintAuthority};
}
export async function readMint(mint: string) {
  mint=new PublicKey(mint.trim()).toBase58(); await assertTestnet('sol');
  return mintInfo(mint,(await solRpc('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]))?.value);
}
export async function tokenAddress(owner: string,mint: string) {
  return (await PublicKey.findProgramAddress([new PublicKey(owner).toBytes(),TOKEN_PROGRAM.toBytes(),new PublicKey(mint).toBytes()],ATA_PROGRAM))[0].toBase58();
}
export function accountAmount(value: any, owner: string, mint: SplMint): bigint {
  const parsed=value?.data?.parsed, info=parsed?.info, amount=info?.tokenAmount;
  if(value?.owner!==TOKEN_PROGRAM.toBase58() || parsed?.type!=='account' || info?.owner!==owner || info?.mint!==mint.mint || info?.state!=='initialized' || amount?.decimals!==mint.decimals || typeof amount?.amount!=='string' || !/^\d{1,20}$/.test(amount.amount) || BigInt(amount.amount)>0xffffffffffffffffn) throw new Error('Token account is invalid, frozen, or belongs to another mint or owner.');
  return BigInt(amount.amount);
}
export async function readTokenAccount(owner: string,mint: SplMint) {
  const address=await tokenAddress(owner,mint.mint);
  const result=await solRpc('getAccountInfo',[address,{encoding:'jsonParsed',commitment:'confirmed'}]);
  if(!result || !Object.prototype.hasOwnProperty.call(result,'value') || (result.value!==null && typeof result.value!=='object')) throw new Error('Invalid token account response.');
  const value=result.value;
  return {address,exists:value!==null,amount:value===null ? 0n : accountAmount(value,owner,mint)};
}
export async function splTransaction(owner: string,to: string,mint: SplMint,amount: bigint,blockhash: string) {
  solRecipient(owner); solRecipient(to);
  if(owner===to || amount<=0n || amount>0xffffffffffffffffn || !Number.isInteger(mint.decimals) || mint.decimals<0 || mint.decimals>18 || base58.decode(blockhash).length!==32) throw new Error('Invalid SPL transfer.');
  const data=new Uint8Array(10); data[0]=12; new DataView(data.buffer).setBigUint64(1,amount,true); data[9]=mint.decimals;
  const tx=new Transaction(); tx.feePayer=new PublicKey(owner); tx.recentBlockhash=blockhash as Blockhash;
  tx.add(new TransactionInstruction({programId:TOKEN_PROGRAM,keys:[
    {pubkey:new PublicKey(await tokenAddress(owner,mint.mint)),isSigner:false,isWritable:true},
    {pubkey:new PublicKey(mint.mint),isSigner:false,isWritable:false},
    {pubkey:new PublicKey(await tokenAddress(to,mint.mint)),isSigner:false,isWritable:true},
    {pubkey:new PublicKey(owner),isSigner:true,isWritable:false}],data}));
  return tx;
}
export async function signSpl(tx: Transaction,keys: MultiKeys,to: string,mint: SplMint,amount: bigint) {
  const expected=await splTransaction(keys.solAddress,to,mint,amount,tx.recentBlockhash!);
  if(hexlify(tx.serializeMessage())!==hexlify(expected.serializeMessage())) throw new Error('SPL review changed.');
  await tx.sign(requireSolSigner(keys));
  requireSolSigner(keys);
  if(!tx.signature || !await tx.verifySignatures()) throw new Error('SPL signature verification failed.');
  const raw = await tx.serialize();
  requireSolSigner(keys);
  return {raw,id:base58.encode(tx.signature)};
}

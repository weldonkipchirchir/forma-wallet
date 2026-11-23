import { PublicKey } from '@solana/web3.js';
import { boundedJson } from './bounded-response';
import { mintInfo, accountAmount, tokenAddress, TOKEN_PROGRAM, parseMints, type SplMint } from './sol-tokens';
import { safeNumber } from './multichain-network';

export const SOL_MAINNET_RPC = 'https://api.mainnet.solana.com';
export const SOL_MAINNET_CONNECTIONS=Object.freeze({solana:SOL_MAINNET_RPC,publicnode:'https://solana-rpc.publicnode.com'});
export type SolanaMainnetConnection=keyof typeof SOL_MAINNET_CONNECTIONS;
export const SOL_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const MAINNET_USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export function listedSolanaMint(address:string){return address===MAINNET_USDT?'USDT':address===MAINNET_USDC?'USDC':undefined;}
/** Display-only metadata for pinned issuer mints. Sending still fetches/rechecks live mint metadata. */
export function listedSolanaDisplayMint(address:string):SplMint|undefined{return listedSolanaMint(address)?{mint:address,decimals:6,mintAuthority:null,freezeAuthority:null}:undefined;}
export const mainnetMintsKey = (owner: string) => `forma.sol.mainnet.mints.v1:${new PublicKey(owner).toBase58()}`;
export const mainnetJournalKey = (owner: string) => `forma.sol.mainnet.submissions.v1:${new PublicKey(owner).toBase58()}`;
export type MainnetSubmission = { id: string; to: string; amount: string; decimals: number; mint?: string; expiry: number; when: number; status: 'unknown' | 'pending' | 'confirmed' | 'failed' };
export function mainnetMints(raw: string | null) {
  if (raw && raw.length > 10000) throw new Error('Mainnet token storage is too large.');
  const value = JSON.parse(raw || '[]');
  if (!Array.isArray(value)) throw new Error('Invalid mainnet token storage.');
  return [MAINNET_USDT, MAINNET_USDC, ...parseMints(value).filter(mint => mint !== MAINNET_USDT && mint !== MAINNET_USDC)];
}
export function mainnetJournal(raw: string | null): MainnetSubmission[] {
  if (raw && raw.length > 100000) throw new Error('Mainnet submission storage is too large. Sending blocked.');
  const value = JSON.parse(raw || '[]');
  if (!Array.isArray(value) || value.length > 100) throw new Error('Invalid mainnet journal. Sending blocked.');
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(row.id) || seen.has(row.id)
      || typeof row.amount !== 'string' || !/^\d{1,20}$/.test(row.amount) || BigInt(row.amount) <= 0n || BigInt(row.amount) > 0xffffffffffffffffn
      || !Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 18
      || !Number.isSafeInteger(row.expiry) || row.expiry < 0 || !Number.isSafeInteger(row.when) || row.when <= 0
      || !['unknown','pending','confirmed','failed'].includes(row.status)) throw new Error('Invalid mainnet submission. Sending blocked.');
    if (typeof row.to !== 'string' || (row.mint !== undefined && typeof row.mint !== 'string')) throw new Error('Invalid Mainnet address.');
    new PublicKey(row.to); if (row.mint !== undefined) new PublicKey(row.mint); else if (row.decimals !== 9) throw new Error('Invalid SOL decimals.');
    seen.add(row.id);
  }
  return value;
}
export function retainMainnetSubmission(rows: MainnetSubmission[], next: MainnetSubmission) {
  const merged = [next, ...rows.filter(row => row.id !== next.id)];
  const unresolved = merged.filter(row => ['pending','unknown'].includes(row.status));
  if (unresolved.length > 50) throw new Error('Resolve outstanding submissions before sending.');
  const result = [...unresolved, ...merged.filter(row => !['pending','unknown'].includes(row.status))].slice(0,100);
  return mainnetJournal(JSON.stringify(result));
}
export function createMainnetApi(signal?: AbortSignal,connection:SolanaMainnetConnection='solana',readFallback=false) {
  if(!Object.prototype.hasOwnProperty.call(SOL_MAINNET_CONNECTIONS,connection))throw new Error('Unsupported Solana RPC connection.');
  const endpoint=SOL_MAINNET_CONNECTIONS[connection];
  let sequence = 0;
  async function request(target:string,method: string, params: unknown[] = []) {
    const id = ++sequence;
    const response = await fetch(target, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id,method,params}), signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store' });
    if (!response.ok) throw new Error('Solana Mainnet RPC unavailable or rate limited. Choose another reviewed connection and refresh.');
    const data = await boundedJson(response, 2_000_000);
    if (data?.jsonrpc !== '2.0' || data.id !== id || data.error !== undefined || !Object.prototype.hasOwnProperty.call(data,'result')) throw new Error('Solana Mainnet request failed. Verify status before retrying.');
    return data.result;
  }
  const readMethods=new Set(['getGenesisHash','getBalance','getAccountInfo','getTokenAccountsByOwner','getSignatureStatuses','getSignaturesForAddress','getTransaction']);
  let readEndpoint=endpoint;
  async function rpc(method:string,params:unknown[]=[]):Promise<any>{
    const read=readFallback&&readMethods.has(method);
    try{return await request(read?readEndpoint:endpoint,method,params);}catch(error){
      if(!read||signal?.aborted||readEndpoint!==endpoint)throw error;
      const alternate=connection==='solana'?SOL_MAINNET_CONNECTIONS.publicnode:SOL_MAINNET_CONNECTIONS.solana;
      if(await request(alternate,'getGenesisHash')!==SOL_MAINNET_GENESIS)throw new Error('Wrong Solana network returned by alternate connection.');
      readEndpoint=alternate;
      return method==='getGenesisHash'?SOL_MAINNET_GENESIS:request(alternate,method,params);
    }
  }
  async function identity() { if (await rpc('getGenesisHash') !== SOL_MAINNET_GENESIS) throw new Error('Wrong Solana network. Mainnet operation blocked.'); }
  async function balance(owner: string) { return BigInt(safeNumber((await rpc('getBalance',[owner,{commitment:'confirmed'}]))?.value)); }
  async function mint(address: string): Promise<SplMint> {
    const info = mintInfo(address,(await rpc('getAccountInfo',[address,{encoding:'jsonParsed',commitment:'confirmed'}]))?.value);
    if (listedSolanaMint(address) && info.decimals !== 6) throw new Error('Official stablecoin mint decimals differ. Operation blocked.');
    return info;
  }
  async function account(owner: string, mint: SplMint) {
    const address = await tokenAddress(owner,mint.mint);
    const result = await rpc('getAccountInfo',[address,{encoding:'jsonParsed',commitment:'confirmed'}]);
    if (!result || !Object.prototype.hasOwnProperty.call(result,'value')) throw new Error('Invalid token account response.');
    return { address, exists: result.value !== null, amount: result.value === null ? 0n : accountAmount(result.value,owner,mint) };
  }
  async function discover(owner: string) {
    await identity();
    const result = await rpc('getTokenAccountsByOwner',[owner,{programId:TOKEN_PROGRAM.toBase58()},{encoding:'jsonParsed',commitment:'confirmed'}]);
    if (!Array.isArray(result?.value) || result.value.length > 1000) throw new Error('Token discovery response exceeds supported limits. Import a mint manually.');
    const found=result.value.filter((row: any) => row?.account?.owner === TOKEN_PROGRAM.toBase58() && row.account.data?.parsed?.info?.owner === owner && /^\d{1,20}$/.test(row.account.data.parsed.info.tokenAmount?.amount) && BigInt(row.account.data.parsed.info.tokenAmount.amount)>0n).map((row:any)=>new PublicKey(row.account.data.parsed.info.mint).toBase58());
    return [...new Set<string>(found)].slice(0,250);
  }
  async function heldBalance(owner:string,mint:SplMint){
    new PublicKey(owner);
    const result=await rpc('getTokenAccountsByOwner',[owner,{mint:mint.mint},{encoding:'jsonParsed',commitment:'confirmed'}]);
    if(!Array.isArray(result?.value)||result.value.length>1000)throw new Error('Unsupported token-account response.');
    const seen=new Set<string>();let total=0n;
    for(const row of result.value){const address=new PublicKey(row.pubkey).toBase58();if(seen.has(address))throw new Error('Duplicate token account.');seen.add(address);total+=accountAmount(row.account,owner,mint);if(total>0xffffffffffffffffn)throw new Error('Token balance exceeds supported range.');}
    return total;
  }
  return {rpc,identity,balance,mint,account,discover,heldBalance};
}

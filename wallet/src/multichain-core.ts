import { HDNodeWallet, Wallet, getBytes, hexlify } from 'ethers';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import * as btc from '@scure/btc-signer';
import { hex, base58 } from '@scure/base';
import { Keypair, PublicKey, SystemProgram, Transaction as SolTransaction, type Blockhash } from '@solana/web3.js';
import { validateKeystore } from './security';

export const MULTI_VAULT = 'forma.multichain.testnets.v1';
export const BTC_PATH = "m/84'/1'/0'/0/0";
export const SOL_PATH = "m/44'/501'/0'/0'";
export const BTC_GENESIS = '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943';
export const SOL_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export type Chain = 'btc' | 'sol';
export type MultiKeys = { btcKey: Uint8Array; btcAddress: string; btcScript: Uint8Array; sol: Keypair; solAddress: string };
export function unifiedRoot(wallet: Wallet | HDNodeWallet): HDNodeWallet {
  if (!(wallet instanceof HDNodeWallet) || !wallet.mnemonic) throw new Error('This imported wallet contains an Ethereum key only. Import its original disposable test recovery phrase to derive Bitcoin and Solana accounts. Your existing address and backup are preserved.');
  if (wallet.mnemonic.password) throw new Error('This phrase uses a BIP-39 passphrase, which the current encrypted backup cannot preserve for all networks. Shared accounts are unavailable for this import. Keep its original phrase and passphrase safe.');
  return wallet;
}
export function slip10Seed(seed: Uint8Array, path: readonly number[]) {
  if (path.some(index => !Number.isSafeInteger(index) || index < 0 || index >= 0x80000000)) throw new Error('Invalid hardened derivation index.');
  let node = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  for (const index of path) {
    const data = new Uint8Array(37); data.set(node.slice(0, 32), 1);
    new DataView(data.buffer).setUint32(33, index + 0x80000000, false);
    const next = hmac(sha512, node.slice(32), data); node.fill(0); node = next;
  }
  const result = node.slice(0, 32); node.fill(0); return result;
}
export const solSeed = (seed: Uint8Array) => slip10Seed(seed, [44, 501, 0, 0]);
export async function deriveMulti(root: HDNodeWallet): Promise<MultiKeys> {
  if (!root.mnemonic) throw new Error('This vault requires a recovery phrase.');
  const seed = getBytes(root.mnemonic.computeSeed());
  try {
    const child = HDNodeWallet.fromSeed(seed).derivePath(BTC_PATH);
    const btcKey = getBytes(child.privateKey);
    const payment = btc.p2wpkh(getBytes(child.publicKey), btc.TEST_NETWORK);
    const secret = solSeed(seed), sol = await Keypair.fromSeed(secret); secret.fill(0);
    return { btcKey, btcAddress: payment.address!, btcScript: payment.script, sol, solAddress: sol.publicKey.toBase58() };
  } finally { seed.fill(0); }
}
export function clearMulti(keys?: MultiKeys) { keys?.btcKey.fill(0); keys?.sol.secretKey.fill(0); }
export function encodeMultiBackup(vault: string): string {
  validateKeystore(vault);
  return JSON.stringify({ format: 'forma-multichain-testnet-v1', vault: JSON.parse(vault) }, null, 2);
}
export function decodeMultiBackup(text: string): string {
  if (text.length > 100000) throw new Error('Choose a backup smaller than 100 KB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Choose a valid Bitcoin & Solana encrypted backup.'); }
  if (data?.format !== 'forma-multichain-testnet-v1') throw new Error('Use a Forma Bitcoin & Solana backup, not an Ethereum backup.');
  const vault = JSON.stringify(data.vault); validateKeystore(vault); return vault;
}
export function units(input: string, decimals: number): bigint {
  const value = input.trim();
  if (value.length > 40 || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new Error(`Enter a positive amount with up to ${decimals} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is outside the supported range.');
  return amount;
}
export function displayUnits(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  return `${amount / scale}.${(amount % scale).toString().padStart(decimals, '0')}`;
}
export function btcRecipient(address: string): string {
  const value = address.trim();
  if (!/^tb1q[ac-hj-np-z02-9]{38}$/.test(value)) throw new Error('Use a Bitcoin Testnet native SegWit address (tb1q, 42 characters). Mainnet and other address types are not supported.');
  const decoded = btc.Address(btc.TEST_NETWORK).decode(value);
  if (decoded.type !== 'wpkh') throw new Error('Only Bitcoin Testnet native SegWit recipients are supported.');
  return value;
}
export function solRecipient(address: string): PublicKey {
  let key: PublicKey;
  try { key = new PublicKey(address.trim()); } catch { throw new Error('Enter a valid Solana public address.'); }
  if (!PublicKey.isOnCurve(key.toBytes()) || key.equals(SystemProgram.programId)) throw new Error('Use a standard Solana wallet address, not a program address.');
  return key;
}
export type VerifiedUtxo = { txid: string; vout: number; value: bigint; raw: Uint8Array };
export function verifyUtxo(raw: Uint8Array, txid: string, vout: number, value: bigint, script: Uint8Array): VerifiedUtxo {
  const tx = btc.Transaction.fromRaw(raw, { allowUnknownOutputs: true });
  if (tx.id !== txid || !Number.isSafeInteger(vout) || vout < 0 || vout >= tx.outputsLength) throw new Error('Bitcoin funding transaction does not match the requested output.');
  const output = tx.getOutput(vout);
  if (output.amount !== value || !output.script || hexlify(output.script) !== hexlify(script)) throw new Error('Bitcoin funding amount or ownership does not match.');
  return { txid, vout, value, raw };
}
export type BitcoinPlan = { tx: btc.Transaction; to: string; amount: bigint; fee: bigint; change: bigint; inputs: VerifiedUtxo[]; rate: number };
export function bitcoinPlan(keys: MultiKeys, to: string, amount: bigint, rate: number, available: VerifiedUtxo[]): BitcoinPlan {
  to = btcRecipient(to);
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > 100) throw new Error('Fee rate must be 1–100 sat/vB.');
  if (amount < 546n) throw new Error('Send at least 546 satoshis to avoid dust.');
  const inputs: VerifiedUtxo[] = []; let total = 0n, fee = 0n;
  const seen = new Set<string>();
  for (const row of available.slice(0, 20)) {
    const key = `${row.txid}:${row.vout}`;
    if (seen.has(key)) throw new Error('Duplicate Bitcoin funding output.');
    seen.add(key);
    verifyUtxo(row.raw, row.txid, row.vout, row.value, keys.btcScript);
    inputs.push(row); total += row.value;
    fee = BigInt((11 + 70 * inputs.length + 31 * 2) * rate);
    if (total >= amount + fee) break;
  }
  if (total < amount + fee || !inputs.length) throw new Error('Not enough confirmed Bitcoin Testnet funds for amount and fee. At most 20 inputs are supported.');
  let change = total - amount - fee;
  if (change < 546n) { fee += change; change = 0n; }
  if (fee > 100000n) throw new Error('Maximum fee exceeds the 100,000 satoshi test-wallet limit.');
  const tx = new btc.Transaction();
  for (const row of inputs) tx.addInput({ txid: row.txid, index: row.vout, nonWitnessUtxo: row.raw, witnessUtxo: { script: keys.btcScript, amount: row.value } });
  tx.addOutputAddress(to, amount, btc.TEST_NETWORK);
  if (change) tx.addOutputAddress(keys.btcAddress, change, btc.TEST_NETWORK);
  return { tx, to, amount, fee, change, inputs, rate };
}
export function signBitcoin(plan: BitcoinPlan, keys: MultiKeys) {
  // Bind every output and input to the reviewed plan before signing.
  if (plan.tx.version!==2 || plan.tx.lockTime!==0 || plan.tx.inputsLength !== plan.inputs.length || plan.tx.outputsLength !== (plan.change ? 2 : 1)) throw new Error('Bitcoin review changed.');
  for (let i = 0; i < plan.inputs.length; i++) {
    const row = plan.inputs[i]; verifyUtxo(row.raw, row.txid, row.vout, row.value, keys.btcScript);
    const input = plan.tx.getInput(i);
    if (!input.txid || hex.encode(input.txid) !== row.txid || input.index !== row.vout || input.sequence!==0xffffffff) throw new Error('Bitcoin input changed.');
  }
  if (plan.tx.getOutputAddress(0, btc.TEST_NETWORK) !== plan.to || plan.tx.getOutput(0).amount !== plan.amount || plan.tx.fee !== plan.fee) throw new Error('Bitcoin review changed.');
  if (plan.change && (plan.tx.getOutputAddress(1, btc.TEST_NETWORK) !== keys.btcAddress || plan.tx.getOutput(1).amount !== plan.change)) throw new Error('Bitcoin change address changed.');
  plan.tx.sign(keys.btcKey); plan.tx.finalize();
  if (plan.tx.fee < BigInt(plan.tx.vsize * plan.rate)) throw new Error('Bitcoin fee estimate is insufficient. Review again.');
  return { raw: plan.tx.hex, id: plan.tx.id };
}
export function solTransfer(keys: MultiKeys, to: string, amount: bigint, blockhash: string) {
  const recipient = solRecipient(to);
  if (base58.decode(blockhash).length !== 32) throw new Error('Invalid Solana blockhash.');
  const tx = new SolTransaction();
  tx.feePayer = keys.sol.publicKey; tx.recentBlockhash = blockhash as Blockhash;
  return tx.add(SystemProgram.transfer({ fromPubkey: keys.sol.publicKey, toPubkey: recipient, lamports: amount }));
}
export async function signSol(tx: SolTransaction, keys: MultiKeys, to: string, amount: bigint) {
  const expected = solTransfer(keys, to, amount, tx.recentBlockhash!);
  if (hexlify(tx.serializeMessage()) !== hexlify(expected.serializeMessage())) throw new Error('Solana review changed.');
  await tx.sign(keys.sol);
  if (!tx.signature || !await tx.verifySignatures()) throw new Error('Solana signature verification failed.');
  return { raw: await tx.serialize(), id: base58.encode(tx.signature) };
}

import { describe, expect, it, vi, afterEach } from 'vitest';
import { HDNodeWallet, Wallet } from 'ethers';
import * as btc from '@scure/btc-signer';
import { Keypair, SystemInstruction, Transaction as SolTransaction } from '@solana/web3.js';
import { base58, hex } from '@scure/base';
import { unifiedRoot, deriveMulti, slip10Seed, units, btcRecipient, solRecipient, verifyUtxo, bitcoinPlan, signBitcoin, solTransfer, signSol, encodeMultiBackup, decodeMultiBackup, BTC_GENESIS, SOL_GENESIS } from './multichain-core';
import { restoreBackup } from './security';
import { verifyBackup, changePassword } from './recovery';
import { assertTestnet, readMultiBalance, safeNumber, solSimulate, broadcastBitcoin, broadcastSol, submissionStatus } from './multichain-network';
import { parseMultiJournal } from './multichain';
import { clearMulti, requireSolSigner } from './multichain-core';

const root = () => HDNodeWallet.fromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const mockJson = (data: unknown) => new Response(JSON.stringify({jsonrpc:"2.0",id:1,...data as object}), { status: 200 });
afterEach(() => vi.unstubAllGlobals());
describe('Bitcoin and Solana key and backup boundaries', () => {
  it('revokes retained signing sessions when locked', async () => {
    const keys = await deriveMulti(root());
    expect(requireSolSigner(keys)).toBeDefined();
    clearMulti(keys);
    expect(keys.sol).toBeUndefined();
    expect(keys.btcKey.every(byte => byte === 0)).toBe(true);
    expect(() => requireSolSigner(keys)).toThrow('Wallet locked');
    expect(() => signBitcoin({} as Parameters<typeof signBitcoin>[0], keys)).toThrow('Wallet locked');
    clearMulti(keys);
  });
  it('uses one primary backup and password to restore all three account addresses', async () => {
    const primary = unifiedRoot(root()), original = await deriveMulti(primary);
    const password = 'primary-wallet-password-test';
    const encrypted = await primary.encrypt(password);
    const restored = await restoreBackup(encrypted, password, 'new-primary-password-test', 'new-primary-password-test');
    const recovered = unifiedRoot(restored.wallet), accounts = await deriveMulti(recovered);
    expect(recovered.address).toBe(primary.address);
    expect(accounts.btcAddress).toBe(original.btcAddress);
    expect(accounts.solAddress).toBe(original.solAddress);
    const verified = await verifyBackup(restored.encrypted, 'new-primary-password-test', primary.address);
    expect(verified.address).toBe(primary.address);
    const changed = await changePassword(restored.encrypted, 'new-primary-password-test', 'changed-primary-password', 'changed-primary-password', primary.address);
    const unlocked = unifiedRoot(await Wallet.fromEncryptedJson(changed, 'changed-primary-password'));
    expect((await deriveMulti(unlocked)).solAddress).toBe(original.solAddress);
    expect((await deriveMulti(unlocked)).btcAddress).toBe(original.btcAddress);
  }, 30000);
  it('imports an older wrapped backup as a primary wallet without changing its accounts', async () => {
    const legacy = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk');
    const before = await deriveMulti(legacy), encrypted = await legacy.encrypt('older-wallet-password');
    const wrapper = encodeMultiBackup(encrypted);
    const restored = await restoreBackup(wrapper, 'older-wallet-password', 'imported-local-password', 'imported-local-password');
    const after = await deriveMulti(unifiedRoot(restored.wallet));
    expect(restored.wallet.address).toBe(legacy.address);
    expect(after.btcAddress).toBe(before.btcAddress);
    expect(after.solAddress).toBe(before.solAddress);
    expect(await verifyBackup(wrapper, 'older-wallet-password', legacy.address)).toBeInstanceOf(HDNodeWallet);
    expect(before.btcAddress).not.toBe((await deriveMulti(root())).btcAddress);
    expect(decodeMultiBackup(wrapper)).toBe(encrypted);
  }, 30000);
  it('does not invent new account keys for key-only or passphrase-dependent imports', () => {
    const original = root(), keyOnly = new Wallet(original.privateKey);
    expect(() => unifiedRoot(keyOnly)).toThrow('Ethereum key only');
    expect(keyOnly.address).toBe(original.address);
    const protectedPhrase = HDNodeWallet.fromPhrase(original.mnemonic!.phrase, 'test bip39 passphrase');
    expect(() => unifiedRoot(protectedPhrase)).toThrow('BIP-39 passphrase');
  });
  it('matches published SLIP-0010 ed25519 derivation vectors', () => {
    const seed = hex.decode('000102030405060708090a0b0c0d0e0f');
    expect(hex.encode(slip10Seed(seed, []))).toBe('2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7');
    expect(hex.encode(slip10Seed(seed, [0]))).toBe('68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3');
    expect(hex.encode(slip10Seed(seed, [0, 1]))).toBe('b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2');
    expect(() => slip10Seed(seed, [-1])).toThrow();
  });
  it('restores both deterministic accounts from the encrypted backup and a new local password', async () => {
    const wallet = root(), before = await deriveMulti(wallet);
    const encrypted = await wallet.encrypt('disposable-backup-test-password', undefined);
    const restored = await Wallet.fromEncryptedJson(decodeMultiBackup(encodeMultiBackup(encrypted)), 'disposable-backup-test-password');
    expect(restored).toBeInstanceOf(HDNodeWallet);
    const after = await deriveMulti(restored as HDNodeWallet);
    expect(after.btcAddress).toBe(before.btcAddress);
    expect(after.solAddress).toBe(before.solAddress);
    expect(before.btcAddress).toMatch(/^tb1q/);
    expect(before.solAddress).not.toBe(before.btcAddress);
    await expect(Wallet.fromEncryptedJson(encrypted, 'wrong')).rejects.toThrow();
    expect(() => decodeMultiBackup(encrypted)).toThrow('Bitcoin & Solana');
    expect(() => decodeMultiBackup('x'.repeat(100001))).toThrow('100 KB');
  });
  it('parses amounts exactly and rejects mainnet BTC, malformed addresses and precision loss', async () => {
    const keys = await deriveMulti(root());
    expect(units('0.00000001', 8)).toBe(1n);
    expect(units('0.000000001', 9)).toBe(1n);
    for (const input of ['0', '-1', '1e3', 'NaN', '0.0000000001']) expect(() => units(input, 9)).toThrow();
    expect(() => btcRecipient('bc1q' + 'a'.repeat(38))).toThrow('Testnet');
    expect(btcRecipient(keys.btcAddress)).toBe(keys.btcAddress);
    expect(() => btcRecipient(keys.btcAddress.slice(0, -1) + (keys.btcAddress.endsWith('q') ? 'p' : 'q'))).toThrow();
    expect(solRecipient(keys.solAddress).toBase58()).toBe(keys.solAddress);
    expect(() => solRecipient('11111111111111111111111111111111')).toThrow('program');
    expect(() => solRecipient(keys.btcAddress)).toThrow();
  });
});
describe('Bitcoin funding and transaction binding', () => {
  async function fixture() {
    const keys = await deriveMulti(root()), funding = new btc.Transaction({ allowUnknownInputs: true });
    funding.addInput({ txid: '01'.repeat(32), index: 0 });
    funding.addOutputAddress(keys.btcAddress, 100000n, btc.TEST_NETWORK);
    const raw = funding.unsignedTx, txid = btc.Transaction.fromRaw(raw).id;
    return { keys, raw, txid, input: verifyUtxo(raw, txid, 0, 100000n, keys.btcScript) };
  }
  it('verifies the previous output, signs only reviewed outputs and conserves satoshis', async () => {
    const { keys, input } = await fixture();
    const plan = bitcoinPlan(keys, keys.btcAddress, 20000n, 2, [input]);
    expect(plan.amount + plan.fee + plan.change).toBe(100000n);
    const signed = signBitcoin(plan, keys), decoded = btc.Transaction.fromRaw(Uint8Array.from(signed.raw.match(/../g)!.map(v => parseInt(v, 16))));
    expect(decoded.id).toBe(signed.id);
    expect(decoded.getOutput(0).amount).toBe(20000n);
    expect(decoded.getOutputAddress(1, btc.TEST_NETWORK)).toBe(keys.btcAddress);
  });
  it('rejects forged funding amounts, ownership, fees, dust and changed recipients', async () => {
    const { keys, input, raw, txid } = await fixture();
    expect(() => verifyUtxo(raw, txid, 0, 100001n, keys.btcScript)).toThrow('amount');
    expect(() => verifyUtxo(raw, txid, 0, 100000n, new Uint8Array(22))).toThrow('ownership');
    expect(() => bitcoinPlan(keys, keys.btcAddress, 20000n, 101, [input])).toThrow('Fee rate');
    expect(() => bitcoinPlan(keys, keys.btcAddress, 1n, 2, [input])).toThrow('dust');
    expect(() => bitcoinPlan(keys, keys.btcAddress, 100000n, 2, [input])).toThrow('Not enough');
    const plan = bitcoinPlan(keys, keys.btcAddress, 20000n, 2, [input]);
    plan.tx.updateOutput(0, { amount: 21000n });
    expect(() => signBitcoin(plan, keys)).toThrow('review changed');
  });
  it('rejects a changed Bitcoin input sequence before signing',async()=>{
    const {keys,input}=await fixture();
    const plan=bitcoinPlan(keys,keys.btcAddress,20000n,2,[input]);
    plan.tx.updateInput(0,{sequence:0xfffffffe});
    expect(()=>signBitcoin(plan,keys)).toThrow('input changed');
  });
});
describe('Solana native transfer review', () => {
  it('signs exactly one reviewed native transfer with the expected signer and amount', async () => {
    const keys = await deriveMulti(root()), recipient = await Keypair.generate();
    const tx = solTransfer(keys, recipient.publicKey.toBase58(), 1000000n, SOL_GENESIS);
    const result = await signSol(tx, keys, recipient.publicKey.toBase58(), 1000000n);
    const decoded = SolTransaction.from(result.raw);
    expect(decoded.instructions).toHaveLength(1);
    const instruction = SystemInstruction.decodeTransfer(decoded.instructions[0]);
    expect(instruction.lamports).toBe(1000000n);
    expect(instruction.toPubkey.toBase58()).toBe(recipient.publicKey.toBase58());
    expect(decoded.feePayer?.toBase58()).toBe(keys.solAddress);
    expect(await decoded.verifySignatures()).toBe(true);
    expect(base58.encode(decoded.signature!)).toBe(result.id);
    await expect(signSol(tx, keys, recipient.publicKey.toBase58(), 2n)).rejects.toThrow('review changed');
  });
});
describe('testnet services and uncertain submissions', () => {
  it('blocks the wrong Bitcoin or Solana genesis before reading funds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('wrong genesis')));
    await expect(assertTestnet('btc')).rejects.toThrow('Wrong network');
    vi.stubGlobal('fetch', vi.fn(async () => mockJson({ result: 'mainnet' })));
    await expect(assertTestnet('sol')).rejects.toThrow('Wrong network');
  });
  it('checks devnet identity, confirmed balances and malformed numeric responses', async () => {
    const keys = await deriveMulti(root());
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method;
      return mockJson({ result: method === 'getGenesisHash' ? SOL_GENESIS : { value: 123456789 } });
    }));
    expect((await readMultiBalance('sol', keys)).confirmed).toBe(123456789n);
    expect(() => safeNumber(9007199254740992)).toThrow();
    expect(() => safeNumber(-1)).toThrow();
    expect(() => safeNumber('100')).toThrow();
  });
  it('rejects failed simulation and mismatched broadcast IDs without retrying', async () => {
    const fetcher = vi.fn(async () => mockJson({ result: { value: { err: 'failure' } } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(solSimulate(new Uint8Array(2))).rejects.toThrow('Nothing was broadcast');
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('wrong-id')));
    await expect(broadcastBitcoin('00', 'expected')).rejects.toThrow('differs');
    vi.stubGlobal('fetch', vi.fn(async () => mockJson({ result: 'wrong-id' })));
    await expect(broadcastSol(new Uint8Array(2), 'expected')).rejects.toThrow('differs');
  });
  it('keeps absent Solana submissions uncertain and recognizes explicit failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => mockJson({ result: JSON.parse(String(init?.body)).method === 'getGenesisHash' ? SOL_GENESIS : { value: [null] } })));
    expect(await submissionStatus('sol', 'id')).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => mockJson({ result: JSON.parse(String(init?.body)).method === 'getGenesisHash' ? SOL_GENESIS : { value: [{ err: { InstructionError: [0, 'failure'] } }] } })));
    expect(await submissionStatus('sol', 'id')).toBe('failed');
  });
  it('rejects damaged cached submission rows', () => {
    expect(parseMultiJournal([{ chain: 'mainnet', id: 'bad' }])).toEqual([]);
    expect(parseMultiJournal({})).toEqual([]);
    expect(BTC_GENESIS).toHaveLength(64);
  });
});

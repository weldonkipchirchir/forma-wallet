import { afterEach, describe, expect, it, vi } from 'vitest';
import { HDNodeWallet } from 'ethers';
import { clearMulti, deriveMulti, signSol, solTransfer } from './multichain-core';
import { signSpl, splTransaction } from './sol-tokens';

const recipient = 'HBY78XMozmgC2mNYtqxEQbaLxCBd9gvQfvo9uM8ANYCP';
const blockhash = 'So11111111111111111111111111111111111111112';
const mint = { mint: blockhash, decimals: 9, mintAuthority: null, freezeAuthority: null };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
afterEach(() => vi.restoreAllMocks());

describe('locking during asynchronous Solana signing', () => {
  for (const asset of ['SOL', 'SPL'] as const) {
    for (const stage of ['sign', 'verifySignatures', 'serialize'] as const) {
      it(`rejects ${asset} output when locked during ${stage}`, async () => {
        const keys = await deriveMulti(HDNodeWallet.fromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
        const started = deferred(), resume = deferred();
        try {
          const tx = asset === 'SOL'
            ? solTransfer(keys, recipient, 1n, blockhash)
            : await splTransaction(keys.solAddress, recipient, mint, 1n, blockhash);
          if (stage === 'sign') vi.spyOn(tx, 'sign').mockImplementation(async () => {
            started.resolve(); await resume.promise;
          });
          else if (stage === 'verifySignatures') vi.spyOn(tx, 'verifySignatures').mockImplementation(async () => {
            started.resolve(); await resume.promise; return true;
          });
          else vi.spyOn(tx, 'serialize').mockImplementation(async () => {
            started.resolve(); await resume.promise; return new Uint8Array([1]);
          });
          const signing = asset === 'SOL' ? signSol(tx, keys, recipient, 1n) : signSpl(tx, keys, recipient, mint, 1n);
          // Attach the rejection assertion before releasing the paused operation.
          const rejected = expect(signing).rejects.toThrow('Wallet locked');
          await started.promise;
          clearMulti(keys);
          resume.resolve();
          await rejected;
        } finally { resume.resolve(); clearMulti(keys); }
      });
    }
  }
});

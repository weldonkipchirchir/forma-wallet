import { describe, expect, it } from 'vitest';
import { Wallet, keccak256, ZeroAddress } from 'ethers';
import { importPhrase } from './wallet';
import { restoreBackup } from './security';
import { changePassword, commitPassword, verifyBackup } from './recovery';
import { assertSignedMatchesReview } from './transfer-safety';
import { parseJournal, type TokenSubmission } from './token-journal';
import { inspectSubmission, submitTracked } from './transaction-reliability';
import { tokenInterface } from './token-data';

describe('disposable wallet workflow integration (no browser or live network)', () => {
  it('creates, backs up, restores, changes password and recovers the same account', async () => {
    const original = Wallet.createRandom();
    const oldPassword = 'disposable original password';
    const newPassword = 'disposable replacement password';
    const downloaded = await original.encrypt(oldPassword);
    expect((await verifyBackup(downloaded, oldPassword, original.address)).address).toBe(original.address);
    const restored = await restoreBackup(downloaded, oldPassword, oldPassword, oldPassword);
    expect(restored.wallet.address).toBe(original.address);
    const values = new Map([['vault', restored.encrypted], ['archive', '{}']]);
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const nextBackup = await changePassword(restored.encrypted, oldPassword, newPassword, newPassword, original.address);
    commitPassword(storage, 'vault', 'archive', original.address, restored.encrypted, nextBackup);
    expect((await verifyBackup(storage.getItem('vault')!, newPassword, original.address)).address).toBe(original.address);
    await expect(verifyBackup(storage.getItem('vault')!, oldPassword, original.address)).rejects.toThrow();
    expect((await verifyBackup(downloaded, oldPassword, original.address)).address).toBe(original.address);
    expect(importPhrase(original.mnemonic!.phrase).address).toBe(original.address);
    expect(JSON.parse(storage.getItem('archive')!)[original.address.slice(2).toLowerCase()]).toBe(nextBackup);
  }, 60000);

  it.each(['ETH', 'ERC20'])('retains a timed-out %s submission through reload and later confirms it', async kind => {
    const signer = Wallet.createRandom();
    const recipient = Wallet.createRandom().address;
    const request = { to: recipient, value: kind === 'ETH' ? 1000n : 0n,
      data: kind === 'ETH' ? '0x' : tokenInterface.encodeFunctionData('transfer', [recipient, 1000n]),
      nonce: 0, gasLimit: kind === 'ETH' ? 21000n : 60000n, chainId: 11155111n, type: 2, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
    const raw = await signer.signTransaction(request);
    assertSignedMatchesReview(raw, request, signer.address);
    const entry: TokenSubmission = { hash: keccak256(raw), contract: kind === 'ETH' ? ZeroAddress : recipient,
      to: recipient, amount: '1000', symbol: kind, decimals: 18, nonce: 0, timestamp: new Date().toISOString(), status: 'unknown' };
    let persisted = '', attempts = 0;
    await expect(submitTracked(raw, entry, row => { persisted = JSON.stringify([row]); }, async () => { attempts++; throw new Error('Network response lost'); }, () => true)).rejects.toThrow('uncertain');
    const afterReload = parseJournal(JSON.parse(persisted))[0];
    expect(afterReload.hash).toBe(entry.hash);
    expect(afterReload.status).toBe('unknown');
    const settled = await inspectSubmission(afterReload, { receipt: async () => ({ status: 1, blockNumber: 10 }), height: async () => 12, transaction: async () => null, minedNonce: async () => 1 });
    expect(settled.status).toBe('confirmed'); expect(settled.confirmations).toBe(3);
    expect(attempts).toBe(1);
  });
});

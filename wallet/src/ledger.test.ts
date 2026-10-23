import { describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of } from 'rxjs';
import { Wallet, getBytes, Transaction, type TransactionRequest } from 'ethers';
import { ledgerAction } from './ledger-action';
import { ledgerSigned, ledgerUnsigned, LEDGER_PATH } from './ledger-safety';
import { ledgerMarkup } from './ledger';
const request: TransactionRequest = { to: '0x' + '2'.repeat(40), value: 1n, data: '0x', nonce: 0, type: 2, chainId: 11155111n, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n };
describe('Ledger transaction policy and signature binding', () => {
  it('serializes plain Sepolia ETH and combines only the expected signer signature', async () => {
    const wallet = Wallet.createRandom();
    const raw = await wallet.signTransaction(request);
    const tx = Transaction.from(raw), sig = tx.signature!;
    expect(ledgerUnsigned(request)).toEqual(getBytes(tx.unsignedSerialized));
    expect(ledgerSigned(request, { r: sig.r, s: sig.s, v: sig.v }, wallet.address)).toBe(raw);
    expect(() => ledgerSigned(request, sig, Wallet.createRandom().address)).toThrow('differs');
    expect(LEDGER_PATH).toBe("44'/60'/0'/0/0");
  });
  it.each([
    { chainId: 1n }, { type: 0, gasPrice: 10n, maxFeePerGas: undefined, maxPriorityFeePerGas: undefined },
    { data: '0xa9059cbb' }, { value: 0n }, { to: null },
    { accessList: [{ address: '0x' + '3'.repeat(40), storageKeys: [] }] },
  ])('rejects unsupported signing request %#', change => {
    expect(() => ledgerUnsigned({ ...request, ...change })).toThrow();
  });
  it('has no seed, PIN, token or arbitrary message input', () => {
    expect(ledgerMarkup()).not.toContain('type="password"');
    expect(ledgerMarkup()).toContain('Never enter its recovery phrase or PIN');
    expect(ledgerMarkup()).toContain('Sepolia ETH only');
  });
});
describe('Ledger device action lifecycle', () => {
  it('reports device interaction and resolves a completed operation', async () => {
    const progress = vi.fn(), cancel = vi.fn();
    const output = await ledgerAction({ observable: of({ status: 'pending', intermediateValue: { requiredUserInteraction: 'verify-address' } }, { status: 'completed', output: '0xaddress' }), cancel }, new AbortController().signal, progress);
    expect(output).toBe('0xaddress'); expect(progress).toHaveBeenCalledWith('On your Ledger: verify-address'); expect(cancel).not.toHaveBeenCalled();
  });
  it.each(['error', 'stopped'])('rejects device %s without continuing', async status => {
    const cancel = vi.fn();
    await expect(ledgerAction({ observable: of({ status }), cancel }, new AbortController().signal, () => {})).rejects.toThrow('rejected');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a pending operation when the page/session disconnects', async () => {
    const controller = new AbortController(), events = new Subject<{ status: string; output?: string }>(), cancel = vi.fn();
    const pending = ledgerAction({ observable: events, cancel }, controller.signal, () => {});
    controller.abort();
    await expect(pending).rejects.toThrow('disconnected');
    expect(cancel).toHaveBeenCalledOnce(); expect(events.observed).toBe(false);
  });
  it('rejects a pre-cancelled operation without subscribing', async () => {
    const controller = new AbortController(); controller.abort(); const subscribe = vi.fn();
    await expect(ledgerAction({ observable: new Observable<{ status: string }>(subscribe), cancel: () => {} }, controller.signal, () => {})).rejects.toThrow('cancelled');
    expect(subscribe).not.toHaveBeenCalled();
  });
  it('blocks blind-signing fallback and completion without approval', async () => {
    const cancel = vi.fn();
    await expect(ledgerAction({ observable: of({ status: 'pending', intermediateValue: { step: 'signer.eth.steps.blindSignTransactionFallback' } }), cancel }, new AbortController().signal, () => {})).rejects.toThrow('Blind signing');
    await expect(ledgerAction({ observable: of({ status: 'pending' }), cancel }, new AbortController().signal, () => {})).rejects.toThrow('without approval');
  });
  it('handles device transport failure and times out stalled operations', async () => {
    await expect(ledgerAction({ observable: new Observable<{ status: string }>(s => s.error(new Error('USB unplugged'))), cancel: () => {} }, new AbortController().signal, () => {})).rejects.toThrow('connection failed');
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(); const pending = ledgerAction({ observable: new Subject<{ status: string }>(), cancel }, new AbortController().signal, () => {}, 100);
      const assertion = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(101); await assertion; expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});

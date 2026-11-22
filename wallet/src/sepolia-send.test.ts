import { describe, expect, it, vi } from 'vitest';
import { Wallet, keccak256 } from 'ethers';
import { journalKey, nativeJournalKey, type TokenSubmission } from './token-journal';
import { evmJournalKey } from './evm-assets';
import { submitTracked } from './transaction-reliability';
import { assertSepoliaNonceFree, readSepoliaSubmissions, retainSepoliaSubmission, sepoliaSendLockKey, strictSepoliaJournal, withSepoliaSendLock, type SepoliaSendLocks } from './sepolia-send';

const owner = '0x' + '11'.repeat(20), other = '0x' + '22'.repeat(20);
const firstHash = '0x' + 'aa'.repeat(32), secondHash = '0x' + 'bb'.repeat(32);
const entry = (changes: Partial<TokenSubmission> = {}): TokenSubmission => ({ hash: firstHash, contract: '0x' + '00'.repeat(20), to: other, amount: '1', decimals: 18, symbol: 'ETH', timestamp: '2026-11-22T00:00:00Z', status: 'unknown', nonce: 3, ...changes });
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function lockManager(): SepoliaSendLocks {
  const held = new Set<string>();
  const request = async (name: string, _options: unknown, callback: (lock: Lock | null) => Promise<unknown>) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name, mode: 'exclusive' } as Lock); }
    finally { held.delete(name); }
  };
  return { request: request as SepoliaSendLocks['request'] };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe('strict combined Sepolia nonce checks', () => {
  it('re-reads native and token journals and blocks same or later nonces from either', () => {
    const store = storage();
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).not.toThrow();
    store.setItem(journalKey(owner), JSON.stringify([entry({ contract: other })]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).toThrow('occupies nonce');
    expect(() => assertSepoliaNonceFree(owner, 2, { store })).toThrow('occupies nonce');
    expect(() => assertSepoliaNonceFree(owner, 4, { store })).not.toThrow();
    store.setItem(nativeJournalKey(owner), JSON.stringify([entry({ hash: secondHash, nonce: 4, status: 'pending' })]));
    expect(readSepoliaSubmissions(owner, store)).toHaveLength(2);
    expect(() => assertSepoliaNonceFree(owner, 4, { store })).toThrow('occupies nonce');
  });

  it('blocks malformed storage, oversized journals and unresolved legacy entries without nonce', () => {
    const store = storage(), key = nativeJournalKey(owner);
    for (const bad of ['', '{broken', '{}', JSON.stringify([entry({ hash: 'invalid' })]), JSON.stringify(Array.from({ length: 201 }, () => entry()))]) {
      store.setItem(key, bad);
      expect(() => assertSepoliaNonceFree(owner, 3, { store })).toThrow();
    }
    store.setItem(key, JSON.stringify([entry({ nonce: undefined })]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).toThrow('legacy');
    store.setItem(key, JSON.stringify([entry({ nonce: undefined, status: 'confirmed' })]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).not.toThrow();
    expect(() => strictSepoliaJournal({ getItem: () => { throw new Error('storage blocked'); } }, key)).toThrow('storage blocked');
  });

  it('refuses missing, fractional, negative and unsafe network nonces', () => {
    for (const nonce of [undefined, null, '3', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertSepoliaNonceFree(owner, nonce, { store: storage() })).toThrow('invalid nonce');
    }
  });

  it('allows a replacement only for one exact current unresolved record at the same nonce', () => {
    const store = storage();
    store.setItem(nativeJournalKey(owner), JSON.stringify([entry()]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: firstHash })).not.toThrow();
    expect(() => assertSepoliaNonceFree(owner, 4, { store, excludeHash: firstHash })).toThrow('changed');
    expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: secondHash })).toThrow('changed');
    expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: 'all' })).toThrow('Invalid replacement');
    for (const changes of [{ status: 'confirmed' as const }, { status: 'failed' as const }, { replacedBy: secondHash }]) {
      store.setItem(nativeJournalKey(owner), JSON.stringify([entry(changes)]));
      expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: firstHash })).toThrow('changed');
    }
  });

  it('does not let replacement exclusion hide another competing token record or duplicate hash', () => {
    const store = storage();
    store.setItem(nativeJournalKey(owner), JSON.stringify([entry()]));
    store.setItem(journalKey(owner), JSON.stringify([entry({ hash: secondHash, contract: other })]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: firstHash })).toThrow('occupies nonce');
    store.setItem(journalKey(owner), JSON.stringify([entry({ contract: other })]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store, excludeHash: firstHash })).toThrow('changed');
  });
});

describe('shared software, token and Ledger send coordination', () => {
  it('rejects a second send while the same account lock is held but permits another account', async () => {
    const locks = lockManager(), paused = deferred(), entered = deferred();
    const first = withSepoliaSendLock(owner, async () => { entered.resolve(); await paused.promise; return 'first'; }, locks);
    await entered.promise;
    const second = vi.fn(async () => 'second');
    await expect(withSepoliaSendLock(owner, second, locks)).rejects.toThrow('Another tab');
    expect(second).not.toHaveBeenCalled();
    await expect(withSepoliaSendLock(other, async () => 'independent', locks)).resolves.toBe('independent');
    paused.resolve(); await expect(first).resolves.toBe('first');
    expect(sepoliaSendLockKey(owner)).toBe(`forma.sepolia.send:${owner}`);
  });

  it('retains the nonce reservation after a timed-out broadcast, blocking a stale second sender', async () => {
    const locks = lockManager(), store = storage(), broadcast = vi.fn(async () => { throw new Error('timeout'); });
    await expect(withSepoliaSendLock(owner, async () => {
      assertSepoliaNonceFree(owner, 3, { store });
      store.setItem(journalKey(owner), JSON.stringify([entry({ contract: other })]));
      await broadcast();
    }, locks)).rejects.toThrow('timeout');
    await expect(withSepoliaSendLock(owner, async () => {
      assertSepoliaNonceFree(owner, 3, { store });
      await broadcast();
    }, locks)).rejects.toThrow('occupies nonce');
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('fails closed when Web Locks are missing and releases locks after a callback error', async () => {
    const work = vi.fn(async () => true);
    await expect(withSepoliaSendLock(owner, work, null as unknown as SepoliaSendLocks)).rejects.toThrow('cannot coordinate');
    expect(work).not.toHaveBeenCalled();
    const locks = lockManager();
    await expect(withSepoliaSendLock(owner, async () => { throw new Error('rejected'); }, locks)).rejects.toThrow('rejected');
    await expect(withSepoliaSendLock(owner, work, locks)).resolves.toBe(true);
  });
});

describe('Sepolia journal retention', () => {
  const indexed = (index: number, status: TokenSubmission['status'] = 'confirmed') => entry({ hash: '0x' + index.toString(16).padStart(64, '0'), nonce: index, status });

  it('preserves an old unresolved nonce through the cap and acknowledgement updates', () => {
    const old = indexed(999, 'unknown');
    const history = [...Array.from({ length: 199 }, (_, i) => indexed(i)), old];
    const pending = indexed(1000, 'pending');
    const first = retainSepoliaSubmission(history, pending);
    expect(first).toHaveLength(200);
    expect(first.slice(0, 2)).toEqual([pending, old]);
    const acknowledged = retainSepoliaSubmission(first, { ...pending, status: 'confirmed' });
    expect(acknowledged).toHaveLength(200);
    expect(acknowledged[0]).toEqual(old);
    expect(acknowledged.filter(row => row.hash === pending.hash)).toEqual([{ ...pending, status: 'confirmed' }]);
    const store = storage(); store.setItem(nativeJournalKey(owner), JSON.stringify(acknowledged));
    expect(() => assertSepoliaNonceFree(owner, old.nonce, { store })).toThrow('occupies nonce');
  });

  it('deduplicates hash casing with the new acknowledgement winning', () => {
    const old = entry(), duplicate = entry({ hash: '0x' + 'AA'.repeat(32), status: 'pending' });
    const update = entry({ hash: duplicate.hash, status: 'confirmed' });
    expect(retainSepoliaSubmission([old, duplicate], update)).toEqual([update]);
  });

  it('rejects uncertain overflow before submitTracked can call its broadcaster', async () => {
    const full = Array.from({ length: 200 }, (_, i) => indexed(i, i % 2 ? 'pending' : 'unknown'));
    const wallet = Wallet.createRandom();
    const raw = await wallet.signTransaction({ to: other, value: 1n, chainId: 11155111n, nonce: 200, type: 2, gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n });
    const update = entry({ hash: keccak256(raw), nonce: 200 });
    const broadcast = vi.fn(async () => ({ hash: update.hash }));
    let persisted = full;
    await expect(submitTracked(raw, update, row => { persisted = retainSepoliaSubmission(persisted, row); }, broadcast, () => true)).rejects.toThrow('journal is full');
    expect(broadcast).not.toHaveBeenCalled();
    expect(persisted).toBe(full);
    expect(retainSepoliaSubmission(full, { ...full[0], status: 'confirmed' })).toHaveLength(200);
  });

  it('does not mistake another EVM chain journal for a Sepolia nonce reservation', () => {
    const store = storage();
    store.setItem(evmJournalKey('base', owner), JSON.stringify([entry()]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).not.toThrow();
    store.setItem(journalKey(owner), JSON.stringify([entry()]));
    expect(() => assertSepoliaNonceFree(owner, 3, { store })).toThrow('occupies nonce');
  });
});

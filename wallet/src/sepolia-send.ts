import { getAddress } from 'ethers';
import { assertNonceFree } from './nonce-safety';
import { journalKey, nativeJournalKey, parseJournal, type TokenSubmission } from './token-journal';

export type SepoliaSendStore = Pick<Storage, 'getItem'>;
export type SepoliaSendLocks = Pick<LockManager, 'request'>;
export const sepoliaSendLockKey = (owner: string) => `forma.sepolia.send:${getAddress(owner).toLowerCase()}`;

/** Invalid storage must not turn an uncertain broadcast into an apparently free nonce. */
export function strictSepoliaJournal(store: SepoliaSendStore, key: string): TokenSubmission[] {
  const text = store.getItem(key);
  if (text === null) return [];
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Local submission history is damaged. Sending is blocked until it is recovered.'); }
  const rows = parseJournal(value);
  if (!Array.isArray(value) || value.length > 200 || rows.length !== value.length) throw new Error('Local submission history is invalid. Sending is blocked.');
  return rows;
}

export function readSepoliaSubmissions(owner: string, store: SepoliaSendStore = localStorage): TokenSubmission[] {
  return [...strictSepoliaJournal(store, nativeJournalKey(getAddress(owner))), ...strictSepoliaJournal(store, journalKey(getAddress(owner)))];
}

/** Keep every uncertain broadcast until resolved; discard only older resolved history. */
export function retainSepoliaSubmission(rows: TokenSubmission[], update: TokenSubmission): TokenSubmission[] {
  const unique = new Map<string, TokenSubmission>();
  for (const row of [update, ...rows]) {
    const hash = row.hash.toLowerCase();
    if (!unique.has(hash)) unique.set(hash, row);
  }
  const merged = [...unique.values()];
  const unresolved = merged.filter(row => row.status === 'pending' || row.status === 'unknown');
  if (unresolved.length > 200) throw new Error('Submission journal is full of unresolved transfers. Sending is blocked until an existing transfer is resolved.');
  return [...unresolved, ...merged.filter(row => row.status === 'confirmed' || row.status === 'failed')].slice(0, 200);
}

/** Call inside the shared lock, after populating or rechecking the pending nonce. */
export function assertSepoliaNonceFree(owner: string, nonce: unknown, options: { excludeHash?: string; store?: SepoliaSendStore } = {}) {
  if (typeof nonce !== 'number' || !Number.isSafeInteger(nonce) || nonce < 0) throw new Error('The network returned an invalid nonce. Nothing was signed.');
  const rows = readSepoliaSubmissions(owner, options.store);
  let candidates = rows;
  if (options.excludeHash !== undefined) {
    if (!/^0x[0-9a-f]{64}$/i.test(options.excludeHash)) throw new Error('Invalid replacement reference. Review again.');
    const matches = rows.filter(row => row.hash.toLowerCase() === options.excludeHash!.toLowerCase());
    if (matches.length !== 1 || matches[0].nonce !== nonce || matches[0].replacedBy !== undefined
      || !['pending', 'unknown'].includes(matches[0].status)) throw new Error('The original transfer changed or is resolved. Review the replacement again.');
    candidates = rows.filter(row => row !== matches[0]);
  }
  if (candidates.some(row => ['pending', 'unknown'].includes(row.status) && row.nonce === undefined)) throw new Error('An unresolved legacy transfer has no recorded nonce. Verify its outcome before sending again.');
  assertNonceFree(candidates, nonce);
}

/** All software ETH, token/allowance and Ledger sends share this same account lock. */
export async function withSepoliaSendLock<T>(owner: string, work: () => Promise<T>, locks: SepoliaSendLocks | undefined = globalThis.navigator?.locks): Promise<T> {
  if (!locks) throw new Error('This browser cannot coordinate safe sends across tabs. Use a current browser over HTTPS or localhost.');
  return locks.request(sepoliaSendLockKey(owner), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Another tab is submitting a Sepolia transfer for this account. Wait for its outcome before trying again.');
    return work();
  });
}

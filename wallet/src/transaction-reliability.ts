import { keccak256 } from 'ethers';
import type { TokenSubmission } from './token-journal';
type Receipt = { status: number | null; blockNumber: number };
export type SubmissionReadApi = {
  receipt(hash: string): Promise<Receipt | null>;
  height(): Promise<number>;
  transaction(hash: string): Promise<unknown | null>;
  minedNonce(): Promise<number>;
};
export async function inspectSubmission(row: TokenSubmission, api: SubmissionReadApi, now = Date.now()): Promise<TokenSubmission> {
  try {
    const receipt = await api.receipt(row.hash);
    if (receipt && (receipt.status === 0 || receipt.status === 1)) {
      const height = await api.height();
      if (!Number.isSafeInteger(receipt.blockNumber) || !Number.isSafeInteger(height) || height < receipt.blockNumber) throw new Error('Inconsistent chain height');
      return { ...row, status: receipt.status === 1 ? 'confirmed' : 'failed', confirmations: height - receipt.blockNumber + 1, observation: undefined };
    }
    if (receipt) throw new Error('Unrecognized receipt status');
    const found = await api.transaction(row.hash);
    if (found) return { ...row, status: 'pending', confirmations: 0, observation: undefined };
    if (row.nonce !== undefined && await api.minedNonce() > row.nonce) {
      return { ...row, status: 'unknown', confirmations: 0, observation: 'nonce-used' };
    }
    return { ...row, status: 'unknown', confirmations: 0, observation: now - Date.parse(row.timestamp) >= 600000 ? 'not-seen' : undefined };
  } catch { return { ...row, status: 'unknown', confirmations: 0, observation: 'rpc-unavailable' }; }
}
export async function inspectSubmissions(rows: TokenSubmission[], api: SubmissionReadApi) {
  const result: TokenSubmission[] = [];
  // Bound concurrency instead of sending hundreds of RPC requests at once.
  for (let i = 0; i < rows.length; i += 4) result.push(...await Promise.all(rows.slice(i, i + 4).map(row => inspectSubmission(row, api))));
  return result;
}
export function submissionDetail(row: TokenSubmission) {
  if (row.observation === 'nonce-used') return 'Nonce already mined, but this receipt is unavailable. A replacement or inconsistent RPC is possible. Verify all account activity before retrying.';
  if (row.observation === 'not-seen') return 'Transaction is at least 10 minutes old and is not currently seen by this RPC. This does not prove it was dropped. Check the explorer before retrying.';
  if (row.observation === 'rpc-unavailable') return 'RPC unavailable or inconsistent. Last outcome cannot be verified. Do not retry automatically.';
  return row.status === 'confirmed' || row.status === 'failed' ? `${row.confirmations ?? 0} confirmations reported by RPC. This is not a finality guarantee.` : 'Outcome not yet confirmed. Check the explorer before sending again.';
}
export async function submitTracked(
  raw: string, row: TokenSubmission, save: (row: TokenSubmission) => void,
  broadcast: (raw: string) => Promise<{ hash: string }>, isCurrent: () => boolean,
) {
  if (!isCurrent()) throw new Error('Wallet locked or review changed. Nothing was broadcast.');
  const hash = keccak256(raw);
  if (hash.toLowerCase() !== row.hash.toLowerCase()) throw new Error('Submission hash mismatch. Nothing was broadcast.');
  save({ ...row, status: 'unknown', confirmations: 0 });
  if (!isCurrent()) throw new Error('Wallet locked or review changed. Nothing was broadcast. A local record was retained.');
  try {
    const sent = await broadcast(raw);
    if (sent.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC hash mismatch');
    save({ ...row, status: 'pending', confirmations: 0 });
    return sent;
  } catch { throw new Error(`Submission uncertain. Transaction ${hash} is saved locally. Check its explorer and account activity before retrying. No automatic retry was made.`); }
}

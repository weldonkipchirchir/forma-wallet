import type { TokenSubmission } from './token-journal';

export function unresolvedSubmission(row: TokenSubmission) {
  return row.status === 'pending' || row.status === 'unknown';
}

/** Rows that would share or jump ahead of a reviewed nonce if it were signed now. */
export function blockingNonceRows(rows: TokenSubmission[], nonce: number) {
  return rows.filter(row => unresolvedSubmission(row)
    && row.replacedBy === undefined
    && row.nonce !== undefined
    && row.nonce >= nonce);
}

export function assertNonceFree(rows: TokenSubmission[], nonce: number) {
  const blocked = blockingNonceRows(rows, nonce);
  if (!blocked.length) return;
  const values = [...new Set(blocked.map(row => row.nonce))].join(', ');
  throw new Error(`An unconfirmed local transfer already occupies nonce ${values}. Speed it up or cancel it before sending another transfer.`);
}

export function earlierPendingCount(rows: TokenSubmission[], nonce: number) {
  return rows.filter(row => unresolvedSubmission(row) && row.replacedBy === undefined && row.nonce !== undefined && row.nonce < nonce).length;
}

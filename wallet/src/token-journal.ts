export type TokenSubmission = { hash: string; contract: string; to: string; amount: string; decimals: number; symbol: string; timestamp: string; status: 'pending' | 'confirmed' | 'failed' | 'unknown'; nonce?: number; confirmations?: number; observation?: 'not-seen' | 'nonce-used' | 'rpc-unavailable' };
export const journalKey = (address: string) => `forma.sepolia.token-submissions.v1:${address.toLowerCase()}`;
export const nativeJournalKey = (address: string) => `forma.sepolia.eth-submissions.v1:${address.toLowerCase()}`;
export function parseJournal(value: unknown): TokenSubmission[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).filter((r): r is TokenSubmission => !!r && typeof r === 'object'
    && typeof r.hash === 'string' && /^0x[0-9a-f]{64}$/i.test(r.hash)
    && typeof r.contract === 'string' && /^0x[0-9a-f]{40}$/i.test(r.contract)
    && typeof r.to === 'string' && /^0x[0-9a-f]{40}$/i.test(r.to)
    && typeof r.amount === 'string' && /^\d{1,78}$/.test(r.amount)
    && Number.isInteger(r.decimals) && r.decimals >= 0 && r.decimals <= 36
    && typeof r.symbol === 'string' && r.symbol.length <= 20
    && typeof r.timestamp === 'string' && Number.isFinite(Date.parse(r.timestamp))
    && ['pending', 'confirmed', 'failed', 'unknown'].includes(r.status)
    && (r.nonce === undefined || Number.isSafeInteger(r.nonce) && r.nonce >= 0)
    && (r.confirmations === undefined || Number.isSafeInteger(r.confirmations) && r.confirmations >= 0)
    && (r.observation === undefined || ['not-seen', 'nonce-used', 'rpc-unavailable'].includes(r.observation)));
}
export async function reconcileJournal(rows: TokenSubmission[], getReceipt: (hash: string) => Promise<{ status: number | null } | null>) {
  return Promise.all(rows.map(async row => {
    try {
      const receipt = await getReceipt(row.hash);
      return { ...row, status: receipt?.status === 1 ? 'confirmed' as const : receipt?.status === 0 ? 'failed' as const : row.status === 'pending' ? 'pending' as const : 'unknown' as const };
    } catch { return { ...row, status: 'unknown' as const }; }
  }));
}

import { boundedJson } from './bounded-response';
export type Activity = {
  hash: string; from: string; to: string; value: string; timestamp: string;
  status: 'pending' | 'confirmed' | 'failed'; kind: 'transaction' | 'internal'; id: string;
};
export const historyKey = (address: string) => `forma.sepolia.history.v1:${address.toLowerCase()}`;
export function mergeActivity(old: Activity[], incoming: Activity[]) {
  const items = new Map(old.map(t => [t.id, t]));
  incoming.forEach(t => items.set(t.id, t));
  return [...items.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 1000);
}
export function parseActivity(rows: unknown, internal = false): Activity[] {
  if (!Array.isArray(rows)) throw new Error('Unexpected activity response.');
  return rows.flatMap((row): Activity[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, any>;
    const hash = r.hash ?? r.transaction_hash;
    const from = r.from?.hash;
    const to = r.to?.hash;
    if (typeof hash !== 'string' || typeof from !== 'string'
      || !/^0x[\da-f]{64}$/i.test(hash) || !/^0x[\da-f]{40}$/i.test(from)
      || (to != null && (typeof to !== 'string' || !/^0x[\da-f]{40}$/i.test(to)))
      || typeof r.value !== 'string' || !/^\d{1,78}$/.test(r.value)
      || typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))
      || (internal && (!Number.isSafeInteger(r.index) || r.index < 0))) return [];
    return [{ hash, from, to: to ?? '', value: String(r.value), timestamp: r.timestamp,
      status: r.status === 'error' || r.success === false || r.error ? 'failed' : r.status === 'ok' || (internal && r.success === true) ? 'confirmed' : 'pending',
      kind: internal ? 'internal' : 'transaction', id: internal ? `${hash}:${r.index}` : hash }];
  });
}
export async function fetchActivity(address: string, internal: boolean, cursor?: Record<string, string | number>) {
  const path = internal ? 'internal-transactions' : 'transactions';
  const query = new URLSearchParams();
  Object.entries(cursor ?? {}).forEach(([k, v]) => query.set(k, String(v)));
  const response = await fetch(`https://eth-sepolia.blockscout.com/api/v2/addresses/${address}/${path}?${query}`, { signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('History service is unavailable. Your cached activity is still available.');
  const data = await boundedJson(response);
  return { items: parseActivity(data.items, internal), cursor: data.next_page_params as Record<string, string | number> | null };
}

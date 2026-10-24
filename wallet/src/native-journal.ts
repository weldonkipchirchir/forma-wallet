type Entry = { chain: string; id: string; status: string };
const unresolved = (row: Entry) => row.status === 'pending' || row.status === 'unknown';

/** Always inspect unresolved records, even when newer resolved records exist. */
export function nativeRefreshRows<T extends Entry>(rows: T[]): T[] {
  return [...rows.filter(unresolved), ...rows.filter(row => !unresolved(row)).slice(0, 20)];
}

/** Retention must never silently discard an uncertain broadcast. */
export function retainNativeSubmission<T extends Entry>(rows: T[], update: T): T[] {
  const merged = [update, ...rows.filter(row => row.chain !== update.chain || row.id !== update.id)];
  const pending = merged.filter(unresolved);
  if (pending.length > 100) throw new Error('Submission journal is full of unresolved transfers. Resolve them before sending again.');
  return [...pending, ...merged.filter(row => !unresolved(row))].slice(0, 100);
}

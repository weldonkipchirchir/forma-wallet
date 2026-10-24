import type { Activity } from './activity';
export function filterLoadedActivity(rows: Activity[], owner: string, direction: string, status: string, search: string) {
  const address = owner.toLowerCase(), query = search.trim().toLowerCase();
  return rows.filter(row => {
    const sent = row.from.toLowerCase() === address;
    return (direction === 'all' || (direction === 'sent' ? sent : !sent))
      && (status === 'all' || row.status === status)
      && (!query || [row.hash, row.from, row.to].some(value => value.toLowerCase().includes(query)));
  });
}
export function matchesNativeActivity(row: { id: string; status: string; to?: string; mint?: string; movements?: { mint?: string }[] }, status: string, search: string) {
  const query = search.trim().toLowerCase();
  return (status === 'all' || row.status === status)
    && [row.id, row.to || '', row.mint || '', ...(row.movements || []).map(movement => movement.mint || '')]
      .some(value => value.toLowerCase().includes(query));
}

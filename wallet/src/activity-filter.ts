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

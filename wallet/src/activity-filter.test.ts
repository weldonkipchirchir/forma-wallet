import { describe, expect, it } from 'vitest';
import { filterLoadedActivity } from './activity-filter';
import type { Activity } from './activity';
const rows: Activity[] = [
  { id: '1', hash: '0xABC', from: '0xOwner', to: '0xRecipient', status: 'confirmed', value: '10', timestamp: '', kind: 'transaction' },
  { id: '2', hash: '0xDEF', from: '0xSender', to: '0xOwner', status: 'pending', value: '20', timestamp: '', kind: 'internal' },
  { id: '3', hash: '0xBAD', from: '0xOwner', to: '', status: 'failed', value: '30', timestamp: '', kind: 'transaction' },
];
describe('loaded activity filters', () => {
  it('combines status, direction and case-insensitive hash/address searches', () => {
    expect(filterLoadedActivity(rows, '0xOWNER', 'sent', 'confirmed', '  abc ')).toEqual([rows[0]]);
    expect(filterLoadedActivity(rows, '0xOwner', 'received', 'pending', 'sender')).toEqual([rows[1]]);
    expect(filterLoadedActivity(rows, '0xOwner', 'sent', 'failed', '')).toEqual([rows[2]]);
    expect(filterLoadedActivity(rows, '0xOwner', 'sent', 'pending', '')).toEqual([]);
  });
  it('preserves order and source records when filters are cleared', () => {
    expect(filterLoadedActivity(rows, '0xOwner', 'all', 'all', '')).toEqual(rows);
    expect(rows).toHaveLength(3);
  });
});

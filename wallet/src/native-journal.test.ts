import { describe, expect, it } from 'vitest';
import { nativeRefreshRows, retainNativeSubmission } from './native-journal';
const row = (id: string, status = 'confirmed', chain = 'sol') => ({ id, status, chain });
describe('native submission retention and refresh', () => {
  it('refreshes old unresolved records behind twenty newer confirmed transfers', () => {
    const old = row('old', 'unknown');
    const records = [...Array.from({ length: 30 }, (_, i) => row(String(i))), old];
    expect(nativeRefreshRows(records)).toContain(old);
    expect(nativeRefreshRows(records)).toHaveLength(21);
  });
  it('preserves uncertain records when the journal reaches its retention limit', () => {
    const old = row('old', 'pending');
    const records = [...Array.from({ length: 99 }, (_, i) => row(String(i))), old];
    const updated = retainNativeSubmission(records, row('new'));
    expect(updated).toHaveLength(100);
    expect(updated).toContain(old);
    expect(updated).toContainEqual(row('new'));
  });
  it('replaces only the matching chain record and rejects uncertain overflow', () => {
    expect(retainNativeSubmission([row('same', 'unknown'), row('same', 'pending', 'btc')], row('same')))
      .toEqual([row('same', 'pending', 'btc'), row('same')]);
    const full = Array.from({ length: 100 }, (_, i) => row(String(i), 'unknown'));
    expect(() => retainNativeSubmission(full, row('extra', 'unknown'))).toThrow('journal is full');
    expect(retainNativeSubmission(full, row('0', 'confirmed'))).toHaveLength(100);
  });
});

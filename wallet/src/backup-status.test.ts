import { describe, expect, it } from 'vitest';
import { backupStage, recordBackup } from './backup-status';
describe('backup progress', () => {
  it('tracks each wallet and encrypted vault revision separately', () => {
    const rows = new Map<string, string>();
    const store = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
    expect(backupStage(store, '0xA', 'vault-1')).toBe('needed');
    recordBackup(store, '0xA', 'vault-1', 'requested');
    expect(backupStage(store, '0xa', 'vault-1')).toBe('requested');
    recordBackup(store, '0xa', 'vault-1', 'verified');
    recordBackup(store, '0xa', 'vault-1', 'requested');
    expect(backupStage(store, '0xa', 'vault-1')).toBe('verified');
    expect(backupStage(store, '0xa', 'vault-2')).toBe('needed');
    expect(backupStage(store, '0xb', 'vault-1')).toBe('needed');
    expect([...rows.values()].join()).not.toContain('vault-1');
  });
  it('does not treat invalid or inaccessible metadata as verification', () => {
    const store = { getItem: () => '{bad', setItem: () => { throw new Error('full'); } };
    expect(backupStage(store, 'a', 'vault')).toBe('needed');
    expect(recordBackup(store, 'a', 'vault', 'verified')).toBe(false);
  });
});

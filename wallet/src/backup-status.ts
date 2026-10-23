import { id } from 'ethers';
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type BackupStage = 'needed' | 'requested' | 'verified';
const key = (address: string) => `forma.backup-status.${address.toLowerCase()}`;
export function backupStage(storage: Store, address: string, vault: string): BackupStage {
  try {
    const row = JSON.parse(storage.getItem(key(address)) || 'null');
    if (row?.fingerprint === id(vault) && ['requested', 'verified'].includes(row.stage)) return row.stage;
  } catch { /* Missing, damaged or unavailable metadata is not proof of a backup. */ }
  return 'needed';
}
export function recordBackup(storage: Store, address: string, vault: string, stage: Exclude<BackupStage, 'needed'>): boolean {
  try {
    const next = backupStage(storage, address, vault) === 'verified' ? 'verified' : stage;
    storage.setItem(key(address), JSON.stringify({ fingerprint: id(vault), stage: next }));
    return true;
  } catch { return false; }
}
export function backupGuidance(stage: BackupStage): string {
  if (stage === 'verified') return 'Current backup verified on this browser. Keep the file and its password safe.';
  if (stage === 'requested') return 'Download requested. Check the file was saved, then verify it under Recovery & import.';
  return 'Current backup not verified. Download your encrypted backup, then verify it under Recovery & import.';
}

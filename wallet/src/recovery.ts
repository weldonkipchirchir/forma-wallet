import { Wallet } from 'ethers';
import { validateKeystore, walletBackupJson } from './security';
import { validatePassword } from './wallet';

export async function verifyBackup(json: string, password: string, expected: string) {
  json = walletBackupJson(json);
  validateKeystore(json);
  const wallet = await Wallet.fromEncryptedJson(json, password);
  if (wallet.address.toLowerCase() !== expected.toLowerCase()) throw new Error('This backup belongs to a different wallet. Your current wallet was not changed.');
  return wallet;
}

export async function changePassword(json: string, oldPassword: string, password: string, confirmation: string, expected: string) {
  validatePassword(password, confirmation);
  const wallet = await verifyBackup(json, oldPassword, expected);
  return wallet.encrypt(password);
}

export type AccountPasswordUpdate = { address: string; vaultKey: string; oldJson: string; nextJson: string };

// Re-encrypt every account in one wallet group so unlock, switching and backups keep one password.
// All writes roll back together; a damaged archive aborts before any vault changes.
export function commitGroupPassword(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, vaultKey: string, archiveKey: string, activeAddress: string, updates: AccountPasswordUpdate[]) {
  if (!updates.length) throw new Error('No accounts to update.');
  if (!updates.some(update => update.address.toLowerCase() === activeAddress.toLowerCase() && update.vaultKey === vaultKey)) throw new Error('Active account is missing from the password update.');
  for (const update of updates) if (storage.getItem(update.vaultKey) !== update.oldJson) throw new Error('Wallet changed. Unlock and try again.');
  const oldArchive = storage.getItem(archiveKey);
  let saved: Record<string, string>;
  try { const value = JSON.parse(oldArchive ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); saved = value; }
  catch { throw new Error('Saved wallet list is damaged. Download a backup before continuing.'); }
  const previous = updates.map(update => [update.vaultKey, storage.getItem(update.vaultKey)] as const);
  try {
    for (const update of updates) storage.setItem(update.vaultKey, update.nextJson);
    for (const update of updates) saved[update.address.toLowerCase().replace(/^0x/, '')] = update.nextJson;
    storage.setItem(archiveKey, JSON.stringify(saved));
  } catch (error) {
    for (const [key, value] of previous) { try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Best-effort rollback. */ } }
    try { if (oldArchive === null) storage.removeItem(archiveKey); else storage.setItem(archiveKey, oldArchive); } catch { /* Best-effort rollback. */ }
    throw error;
  }
}

// One authoritative write: switching back must not revive the previous password.
// Archive failure leaves the active vault untouched; active-write failure rolls back.
export function commitPassword(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, vaultKey: string, archiveKey: string, address: string, oldJson: string, nextJson: string) {
  if (storage.getItem(vaultKey) !== oldJson) throw new Error('Wallet changed. Unlock and try again.');
  const oldArchive = storage.getItem(archiveKey);
  let saved: Record<string, string>;
  try { const value = JSON.parse(oldArchive ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); saved = value; }
  catch { throw new Error('Saved wallet list is damaged. Download a backup before continuing.'); }
  const identity = address.toLowerCase().replace(/^0x/, '');
  for (const [key, json] of Object.entries(saved)) {
    try { if (typeof json === 'string' && JSON.parse(json).address?.toLowerCase().replace(/^0x/, '') === identity) saved[key] = nextJson; }
    catch { /* Preserve unrelated damaged entries for recovery. */ }
  }
  saved[identity] = nextJson;
  storage.setItem(archiveKey, JSON.stringify(saved));
  try { storage.setItem(vaultKey, nextJson); }
  catch (error) { if (oldArchive === null) storage.removeItem(archiveKey); else storage.setItem(archiveKey, oldArchive); throw error; }
}

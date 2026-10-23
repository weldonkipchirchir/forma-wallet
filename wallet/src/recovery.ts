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

// One authoritative write: switching back must not revive the previous password.
// Archive failure leaves the active vault untouched; active-write failure rolls back.
export function commitPassword(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, vaultKey: string, archiveKey: string, address: string, oldJson: string, nextJson: string) {
  if (storage.getItem(vaultKey) !== oldJson) throw new Error('Wallet changed. Unlock and try again.');
  const oldArchive = storage.getItem(archiveKey);
  let saved: Record<string, string>;
  try { const value = JSON.parse(oldArchive ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); saved = value; }
  catch { throw new Error('Saved wallet list is damaged. Download a backup before continuing.'); }
  saved[address.toLowerCase().replace(/^0x/, '')] = nextJson;
  storage.setItem(archiveKey, JSON.stringify(saved));
  try { storage.setItem(vaultKey, nextJson); }
  catch (error) { if (oldArchive === null) storage.removeItem(archiveKey); else storage.setItem(archiveKey, oldArchive); throw error; }
}

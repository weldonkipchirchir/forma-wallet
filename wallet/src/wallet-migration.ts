import { validateKeystore } from './security';
const OLD_VAULT = 'forma.multichain.testnets.v1';
export function preserveImportedWallet(storage: Pick<Storage, 'getItem' | 'setItem'>, archiveKey: string): boolean {
  const vault = storage.getItem(OLD_VAULT);
  if (!vault) return false;
  validateKeystore(vault);
  const address = JSON.parse(vault).address;
  if (typeof address !== 'string' || !/^[a-f0-9]{40}$/i.test(address)) throw new Error('Older wallet identity is invalid. Its original storage has been preserved.');
  const archive = JSON.parse(storage.getItem(archiveKey) || '{}');
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) throw new Error('Saved wallet archive needs recovery. Original wallet storage is preserved.');
  const alias = `imported:${address.toLowerCase()}`;
  if (Object.values(archive).includes(vault)) return false;
  if (archive[alias] !== undefined) return false; // A later password change may have re-encrypted this slot.
  // Preserve the original blob too. Never overwrite a same-address primary entry.
  storage.setItem(archiveKey, JSON.stringify({ ...archive, [alias]: vault }));
  return true;
}
export function savedWalletLabel(key: string, vault: string) {
  try {
    const address = JSON.parse(vault).address;
    if (typeof address === 'string' && /^[a-f0-9]{40}$/i.test(address)) return `0x${address}${key.startsWith('imported:') ? ' · imported wallet' : ''}`;
  } catch { /* A damaged entry can still be identified without interpolating JSON. */ }
  return 'Saved wallet';
}

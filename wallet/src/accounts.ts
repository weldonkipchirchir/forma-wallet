import { getAddress, HDNodeWallet, Wallet } from 'ethers';
import { safeTokenText } from './transfer-safety';
import { validateKeystore } from './security';

export type AccountKind = 'hd' | 'imported';
export type WalletAccount = {
  address: string;
  kind: AccountKind;
  index?: number;
  nickname?: string;
  addedAt: string;
};
export type AccountGroup = { primary: string; accounts: WalletAccount[] };
export type AccountRegistry = { version: 1; groups: AccountGroup[] };

export const ACCOUNTS_KEY = 'forma.sepolia.accounts.v1';
export const ACCOUNT_VAULT_PREFIX = 'forma.sepolia.account.vault.v1:';
export const MAX_ACCOUNTS_PER_GROUP = 100;
export const MAX_GROUPS = 20;

export type AccountStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const accountVaultKey = (address: string) => `${ACCOUNT_VAULT_PREFIX}${getAddress(address).toLowerCase()}`;

export function addressKey(address: string) {
  return getAddress(address).toLowerCase();
}

export function nicknameInput(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error('Enter a nickname of up to 40 characters.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!safeTokenText(trimmed, 40)) throw new Error('Use a nickname of 1 to 40 characters without control characters.');
  return trimmed;
}

export function accountLabel(account: Pick<WalletAccount, 'kind' | 'index' | 'nickname'>) {
  if (account.nickname) return account.nickname;
  if (account.kind === 'hd') return typeof account.index === 'number' ? `Account ${account.index + 1}` : 'Phrase-backed account';
  return 'Imported account';
}

export function vaultMetadata(json: string) {
  let data: Record<string, unknown>;
  try { data = JSON.parse(json); } catch { throw new Error('Encrypted account is not valid JSON.'); }
  const raw = typeof data?.address === 'string' ? data.address.replace(/^0x/i, '') : '';
  if (!/^[0-9a-f]{40}$/i.test(raw)) throw new Error('Encrypted account address is missing or invalid.');
  const address = getAddress(`0x${raw.toLowerCase()}`);
  const path = (data?.['x-ethers'] as { path?: unknown } | undefined)?.path;
  let index: number | undefined;
  if (typeof path === 'string') {
    const match = /^m(?:\/\d+'?)+$/i.test(path) ? /\/(\d+)'?$/.exec(path) : null;
    if (match && Number(match[1]) <= 100) index = Number(match[1]);
  }
  return { address, index, hasPhrase: typeof path === 'string' };
}

function parseAccount(row: unknown): WalletAccount | null {
  try {
    if (!row || typeof row !== 'object') return null;
    const value = row as Record<string, unknown>;
    const address = getAddress(String(value.address));
    if (value.kind !== 'hd' && value.kind !== 'imported') return null;
    if (typeof value.addedAt !== 'string' || !Number.isFinite(Date.parse(value.addedAt))) return null;
    let index: number | undefined;
    if (value.kind === 'hd' && value.index !== undefined) {
      if (!Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) > 100) return null;
      index = value.index as number;
    }
    const nickname = nicknameInput(value.nickname);
    return { address, kind: value.kind, ...(index === undefined ? {} : { index }), ...(nickname ? { nickname } : {}), addedAt: value.addedAt };
  } catch { return null; }
}

export function parseAccountRegistry(value: unknown): AccountRegistry {
  const empty: AccountRegistry = { version: 1, groups: [] };
  if (!value || typeof value !== 'object') return empty;
  const groups = (value as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return empty;
  const seen = new Set<string>();
  const parsed: AccountGroup[] = [];
  for (const group of groups.slice(0, MAX_GROUPS)) {
    if (!group || typeof group !== 'object' || !Array.isArray((group as { accounts?: unknown }).accounts)) continue;
    let primary: string;
    try { primary = getAddress(String((group as { primary?: unknown }).primary)); } catch { continue; }
    const accounts: WalletAccount[] = [];
    for (const row of ((group as { accounts: unknown[] }).accounts).slice(0, MAX_ACCOUNTS_PER_GROUP)) {
      const account = parseAccount(row);
      if (!account) continue;
      const key = account.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      accounts.push(account);
    }
    if (!accounts.length) continue;
    if (!accounts.some(account => account.address === primary)) primary = accounts[0].address;
    parsed.push({ primary, accounts });
  }
  return { version: 1, groups: parsed };
}

export function loadAccountRegistry(storage: AccountStorage): AccountRegistry {
  const raw = storage.getItem(ACCOUNTS_KEY);
  if (!raw) return { version: 1, groups: [] };
  try { return parseAccountRegistry(JSON.parse(raw)); } catch { return { version: 1, groups: [] }; }
}

export function saveAccountRegistry(storage: AccountStorage, registry: AccountRegistry) {
  storage.setItem(ACCOUNTS_KEY, JSON.stringify(registry));
}

export function findGroup(registry: AccountRegistry, address: string): AccountGroup | undefined {
  const key = addressKey(address);
  return registry.groups.find(group => group.accounts.some(account => account.address.toLowerCase() === key));
}

export function findAccount(registry: AccountRegistry, address: string): WalletAccount | undefined {
  return findGroup(registry, address)?.accounts.find(account => account.address.toLowerCase() === addressKey(address));
}

export function groupForAddress(storage: AccountStorage, address: string) {
  return findGroup(loadAccountRegistry(storage), address);
}

export function nextHdIndex(group: AccountGroup | undefined) {
  const used = new Set((group?.accounts ?? []).flatMap(account => account.kind === 'hd' && typeof account.index === 'number' ? [account.index] : []));
  const highest = Math.max(-1, ...used);
  if (highest < 100) return highest + 1;
  for (let index = 0; index <= 100; index++) if (!used.has(index)) return index;
  throw new Error('All 101 account indexes are already in use.');
}

// Adopt the legacy single-vault keystore into the account registry.
// Idempotent: existing metadata and newer encrypted copies are never overwritten.
export function adoptActiveVault(storage: AccountStorage, vaultJson: string): AccountGroup {
  validateKeystore(vaultJson);
  const metadata = vaultMetadata(vaultJson);
  const registry = loadAccountRegistry(storage);
  const existing = findGroup(registry, metadata.address);
  const key = accountVaultKey(metadata.address);
  if (existing) {
    if (!storage.getItem(key)) storage.setItem(key, vaultJson);
    return existing;
  }
  const account: WalletAccount = {
    address: metadata.address,
    kind: metadata.hasPhrase ? 'hd' : 'imported',
    ...(metadata.index === undefined ? {} : { index: metadata.index }),
    addedAt: new Date().toISOString(),
  };
  const group: AccountGroup = { primary: account.address, accounts: [account] };
  if (registry.groups.length >= MAX_GROUPS) throw new Error(`Up to ${MAX_GROUPS} account groups are supported in this browser.`);
  storage.setItem(key, vaultJson);
  try { saveAccountRegistry(storage, { version: 1, groups: [...registry.groups, group] }); }
  catch (error) { try { storage.removeItem(key); } catch { /* Keep the original error. */ } throw error; }
  return group;
}

export function registerNewAccount(storage: AccountStorage, primary: string, account: WalletAccount, vaultJson: string): AccountGroup {
  validateKeystore(vaultJson);
  const metadata = vaultMetadata(vaultJson);
  if (metadata.address !== getAddress(account.address)) throw new Error('Encrypted account does not match the account being added.');
  const nickname = nicknameInput(account.nickname);
  const record: WalletAccount = {
    address: getAddress(account.address),
    kind: account.kind,
    ...(account.kind === 'hd' && account.index !== undefined ? { index: account.index } : {}),
    ...(nickname ? { nickname } : {}),
    addedAt: typeof account.addedAt === 'string' && Number.isFinite(Date.parse(account.addedAt)) ? account.addedAt : new Date().toISOString(),
  };
  if (record.kind === 'hd' && record.index !== undefined && (record.index < 0 || record.index > 100)) throw new Error('Account index must be between 0 and 100.');
  const registry = loadAccountRegistry(storage);
  if (findGroup(registry, record.address)) throw new Error('This account is already in your wallet.');
  const groupIndex = registry.groups.findIndex(group => group.primary === getAddress(primary));
  if (groupIndex < 0) throw new Error('Account list is unavailable. Unlock the wallet again before adding an account.');
  const group = registry.groups[groupIndex];
  if (group.accounts.length >= MAX_ACCOUNTS_PER_GROUP) throw new Error(`Up to ${MAX_ACCOUNTS_PER_GROUP} accounts per wallet are supported.`);
  if (record.kind === 'hd' && record.index !== undefined && group.accounts.some(row => row.kind === 'hd' && row.index === record.index)) {
    throw new Error(`Account index ${record.index} is already added.`);
  }
  const nextGroup: AccountGroup = { primary: group.primary, accounts: [...group.accounts, record] };
  const nextRegistry: AccountRegistry = {
    version: 1,
    groups: registry.groups.map((row, index) => index === groupIndex ? nextGroup : row),
  };
  const key = accountVaultKey(record.address);
  const prior = storage.getItem(key);
  storage.setItem(key, vaultJson);
  try { saveAccountRegistry(storage, nextRegistry); }
  catch (error) {
    try { if (prior === null) storage.removeItem(key); else storage.setItem(key, prior); } catch { /* Keep the original error. */ }
    throw error;
  }
  return nextGroup;
}

export function renameAccount(storage: AccountStorage, address: string, nickname: unknown): AccountGroup {
  const registry = loadAccountRegistry(storage);
  const groupIndex = registry.groups.findIndex(group => group.accounts.some(account => account.address.toLowerCase() === addressKey(address)));
  if (groupIndex < 0) throw new Error('Account not found.');
  const name = nicknameInput(nickname);
  const group = registry.groups[groupIndex];
  const nextGroup: AccountGroup = {
    primary: group.primary,
    accounts: group.accounts.map(account => account.address.toLowerCase() === addressKey(address)
      ? { ...account, ...(name ? { nickname: name } : { nickname: undefined }) }
      : account),
  };
  saveAccountRegistry(storage, { version: 1, groups: registry.groups.map((row, index) => index === groupIndex ? nextGroup : row) });
  return nextGroup;
}

export function privateKeyInput(value: string): Wallet {
  const normalized = value.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error('Enter a 64-character hexadecimal private key.');
  return new Wallet(`0x${normalized.toLowerCase()}`);
}

export function deriveHdAccount(wallet: HDNodeWallet, index: number): HDNodeWallet {
  if (!Number.isInteger(index) || index < 0 || index > 100) throw new Error('Account index must be between 0 and 100.');
  if (!wallet.mnemonic) throw new Error('This account has no recovery phrase. Import a private key instead.');
  if (!wallet.path) throw new Error('This account does not expose a derivation path.');
  let check: HDNodeWallet;
  try { check = HDNodeWallet.fromPhrase(wallet.mnemonic.phrase, '', wallet.path); }
  catch { throw new Error('This account\'s recovery phrase cannot be re-derived without its BIP-39 passphrase. Import each private key instead.'); }
  if (check.address !== wallet.address) throw new Error('This account was imported with an optional BIP-39 passphrase. Additional accounts cannot be derived; import each private key instead.');
  const base = wallet.path.replace(/\/\d+'?$/, '');
  return HDNodeWallet.fromPhrase(wallet.mnemonic.phrase, '', `${base}/${index}`);
}

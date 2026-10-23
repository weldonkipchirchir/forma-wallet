import { getAddress, parseEther, HDNodeWallet } from 'ethers';

export const CHAIN_ID = 11155111n;
export const VAULT_KEY = 'forma.sepolia.vault.v1';

export function validatePassword(password: string, confirmation: string): void {
  if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match.');
}

export function transferInput(address: string, amount: string) {
  // Resolve literal addresses only; ENS resolution would add a separate trust boundary.
  let to: string;
  try { to = getAddress(address.trim()); } catch { throw new Error('Enter a valid Ethereum address starting with 0x.'); }
  const normalized = amount.trim();
  if (normalized.length > 100) throw new Error('Amount is too long.');
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) throw new Error('Enter a positive ETH amount with up to 18 decimal places.');
  const value = parseEther(normalized);
  if (value <= 0n) throw new Error('The amount must be greater than zero.');
  return { to, value };
}

export function importPhrase(phrase: string, passphrase = '', index = 0) {
  const normalized = phrase.trim().toLowerCase().split(/\s+/).join(' ');
  if (![12, 15, 18, 21, 24].includes(normalized.split(' ').length)) throw new Error('Enter a valid 12, 15, 18, 21 or 24 word recovery phrase.');
  if (!Number.isInteger(index) || index < 0 || index > 100) throw new Error('Account index must be between 0 and 100.');
  try { return HDNodeWallet.fromPhrase(normalized, passphrase, `m/44'/60'/0'/0/${index}`); }
  catch { throw new Error('Recovery phrase is invalid. Check the words and their order.'); }
}

export function requireSepolia(chainId: bigint) {
  if (chainId !== CHAIN_ID) throw new Error('Wrong network. Only Ethereum Sepolia is allowed.');
}

export function affordable(value: bigint, gasLimit: bigint, feePerGas: bigint, balance: bigint) {
  if (value + gasLimit * feePerGas > balance) throw new Error('Not enough Sepolia ETH for the amount and maximum network fee.');
}

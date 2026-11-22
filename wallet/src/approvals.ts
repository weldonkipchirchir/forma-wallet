import { formatUnits, getAddress, MaxUint256, ZeroAddress, type TransactionRequest } from 'ethers';
import { tokenInterface, type Token } from './token-data';

export type ApprovalFinding = { token: string; spender: string; value: bigint; hash: string; timestamp: string };
const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^\d{1,78}$/;
export const APPROVAL_SCAN_LIMIT = 200;

/** Count every indexed row, including invalid rows, against the overall scan budget. */
export function approvalScanPage(raw: unknown, remaining = APPROVAL_SCAN_LIMIT): { items: unknown[]; remaining: number } {
  if (!Array.isArray(raw)) throw new Error('Unexpected approval scan response.');
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > APPROVAL_SCAN_LIMIT) throw new Error('Invalid approval scan budget.');
  const items = raw.slice(0, remaining);
  return { items, remaining: remaining - items.length };
}

function address(value: unknown) {
  if (typeof value !== 'string') return null;
  try { return getAddress(value); } catch { return null; }
}

function decodedValue(row: Record<string, unknown>, name: string) {
  const decoded = row.decoded_input as { parameters?: unknown } | undefined;
  if (!Array.isArray(decoded?.parameters)) return undefined;
  return decoded.parameters.slice(0, 16).find(parameter => parameter && typeof parameter === 'object' && (parameter as { name?: unknown }).name === name) as { value?: unknown } | undefined;
}

export function parseApprovalTransactions(raw: unknown, tracked: Token[], owner: string): ApprovalFinding[] {
  const { items } = approvalScanPage(raw);
  const ownerAddress = getAddress(owner).toLowerCase();
  const trackedAddresses = new Set(tracked.map(token => token.address.toLowerCase()));
  const latest = new Map<string, ApprovalFinding>();
  for (const value of items) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const hash = typeof row.hash === 'string' && hashPattern.test(row.hash) ? row.hash : '';
    const from = address((row.from as { hash?: unknown } | undefined)?.hash);
    const token = address((row.to as { hash?: unknown } | undefined)?.hash);
    const timestamp = typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) ? row.timestamp : '';
    if (!hash || !from || !token || !timestamp || from.toLowerCase() !== ownerAddress || !trackedAddresses.has(token.toLowerCase())) continue;
    const decoded = row.decoded_input as { method_call?: unknown } | undefined;
    const rawInput = typeof row.raw_input === 'string' ? row.raw_input : '';
    if (!(typeof decoded?.method_call === 'string' && /^approve\s*\(/i.test(decoded.method_call)) && row.method !== 'approve' && !rawInput.startsWith('0x095ea7b3')) continue;
    let spenderRaw = decodedValue(row, 'spender')?.value;
    let amountRaw = decodedValue(row, 'value')?.value;
    if ((spenderRaw === undefined || amountRaw === undefined) && rawInput.startsWith('0x095ea7b3')) {
      try {
        const parsed = tokenInterface.parseTransaction({ data: rawInput });
        spenderRaw = parsed?.args[0];
        amountRaw = parsed?.args[1]?.toString();
      } catch { continue; }
    }
    const spender = address(spenderRaw);
    const amount = typeof amountRaw === 'string' && quantityPattern.test(amountRaw) ? BigInt(amountRaw) : null;
    if (!spender || spender === ZeroAddress || amount === null) continue;
    const key = `${token.toLowerCase()}:${spender.toLowerCase()}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(timestamp) > Date.parse(previous.timestamp)) latest.set(key, { token, spender, value: amount, hash, timestamp });
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function revokeRequest(token: Token, spender: string): TransactionRequest {
  const target = address(spender);
  if (!target || target === ZeroAddress) throw new Error('Enter a valid spender address.');
  return { to: token.address, value: 0n, data: tokenInterface.encodeFunctionData('approve', [target, 0n]) };
}

export function isUnlimitedAllowance(value: bigint) {
  return value >= MaxUint256 / 2n;
}

export function allowanceLabel(value: bigint, decimals: number, symbol: string) {
  return `${formatUnits(value, decimals)} ${symbol}`;
}

export function approvalWarning(value: bigint, decimals: number, symbol: string, spender: string) {
  if (value === 0n) return 'No active allowance.';
  if (isUnlimitedAllowance(value)) return `Unlimited or near-unlimited allowance. ${spender} can transfer your entire ${symbol} balance until you revoke it.`;
  return `${spender} can transfer up to ${allowanceLabel(value, decimals, symbol)} from this wallet.`;
}

export function cursorQuery(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const entries = Object.entries(raw).flatMap(([key, value]) => /^[a-z_]{1,40}$/i.test(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? [[key, String(value)] as const] : []);
  return entries.length ? Object.fromEntries(entries) : null;
}

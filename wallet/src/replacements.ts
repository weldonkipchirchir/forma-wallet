import { ZeroAddress, getAddress, type TransactionRequest } from 'ethers';
import { replacementFees, type FeeQuote } from './fees';
import type { TokenSubmission } from './token-journal';
import { CHAIN_ID } from './wallet';

export type ReplacementIntent = 'speed-up' | 'cancel';
export type ReplacementPlan = { row: TokenSubmission; intent: ReplacementIntent; tx: TransactionRequest; quote: FeeQuote };

const unresolved = (row: TokenSubmission) => row.status === 'pending' || row.status === 'unknown';

export function replacementBlockedReason(row: TokenSubmission): string | null {
  if (!unresolved(row)) return 'This transfer is already resolved.';
  if (row.replacedBy) return 'This transfer was already replaced.';
  if (row.nonce === undefined) return 'The original nonce was not recorded, so this transfer cannot be replaced.';
  if (row.contract.toLowerCase() !== ZeroAddress.toLowerCase() || row.symbol !== 'ETH') return 'Replacement is currently available for native ETH transfers only.';
  if (!row.gasLimit || !row.maxFeePerGas || !row.maxPriorityFeePerGas) return 'The original fee details were not recorded, so this transfer cannot be replaced.';
  try {
    if (BigInt(row.gasLimit) <= 0n || BigInt(row.maxFeePerGas) <= 0n) return 'The recorded fee details are unusable.';
  } catch { return 'The recorded fee details are unusable.'; }
  return null;
}

export function planReplacement(row: TokenSubmission, from: string, intent: ReplacementIntent): ReplacementPlan {
  const reason = replacementBlockedReason(row);
  if (reason) throw new Error(reason);
  const owner = getAddress(from);
  const quote = replacementFees({ maxFeePerGas: BigInt(row.maxFeePerGas!), maxPriorityFeePerGas: BigInt(row.maxPriorityFeePerGas!) });
  const common: TransactionRequest = {
    nonce: row.nonce,
    chainId: CHAIN_ID,
    type: 2,
    maxFeePerGas: quote.maxFeePerGas,
    maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
  };
  const tx: TransactionRequest = intent === 'cancel'
    ? { ...common, to: owner, value: 0n, data: '0x', gasLimit: 21_000n }
    : { ...common, to: getAddress(row.to), value: BigInt(row.amount), gasLimit: BigInt(row.gasLimit!) };
  return { row, intent, tx, quote };
}

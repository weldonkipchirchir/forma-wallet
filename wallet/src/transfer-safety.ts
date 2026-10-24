import { getAddress, ZeroAddress, Transaction, type TransactionRequest } from 'ethers';

// Decode the actual bytes going to the RPC, rather than trusting population/signing.
export function assertSignedMatchesReview(raw: string, review: TransactionRequest, sender: string) {
  const tx = Transaction.from(raw);
  const fail = () => { throw new Error('Signed transaction differs from the reviewed transfer. Nothing was broadcast.'); };
  if (!tx.isSigned() || tx.from?.toLowerCase() !== sender.toLowerCase()
    || !Number.isSafeInteger(review.nonce) || Number(review.nonce)<0 || tx.nonce !== review.nonce
    || tx.chainId !== 11155111n || BigInt(review.chainId ?? 0) !== tx.chainId
    || tx.to?.toLowerCase() !== String(review.to).toLowerCase()
    || tx.value !== BigInt(review.value ?? 0) || tx.data !== (review.data ?? '0x')
    || tx.gasLimit !== BigInt(review.gasLimit ?? 0)
    || tx.maxFeePerGas !== BigInt(review.maxFeePerGas ?? 0)
    || tx.maxPriorityFeePerGas !== BigInt(review.maxPriorityFeePerGas ?? 0)
    || tx.type !== 2 || (tx.accessList?.length ?? 0) !== 0
    || (tx.authorizationList?.length ?? 0) !== 0) fail();
}

export function assertFreshReview(reviewedAt: number, now = Date.now()) {
  if (!Number.isFinite(reviewedAt) || now < reviewedAt || now - reviewedAt > 120000) throw new Error('Transfer review expired. Review the address, amount and current fee again.');
}

export function recipientNotice(recipient: string, ownAddress: string, knownRecipients: string[]) {
  const address = getAddress(recipient);
  if (address === ZeroAddress) throw new Error('Do not send to the zero address.');
  if (address.toLowerCase() === ownAddress.toLowerCase()) return 'You are sending to your own wallet. A network fee still applies.';
  const normalized = address.toLowerCase();
  const known = knownRecipients.map(a => a.toLowerCase());
  if (known.includes(normalized)) return 'Previously seen in loaded history; this is not a verified contact. History can contain forged token events. Verify the full address directly with the recipient.';
  if (known.some(a => a !== normalized && a.slice(0, 6) === normalized.slice(0, 6) && a.slice(-4) === normalized.slice(-4))) throw new Error('Possible lookalike address: the start and end match a recipient in loaded history, but the middle differs. Obtain the full address directly from the recipient.');
  return 'First-time recipient in loaded history. Verify the full address directly with the recipient, not by copying a history entry.';
}

export function safeTokenText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value);
}

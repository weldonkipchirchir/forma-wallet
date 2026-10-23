import { getBytes, ZeroAddress, Signature, Transaction, type TransactionRequest, type TransactionLike } from 'ethers';
import { assertSignedMatchesReview } from './transfer-safety';
export const LEDGER_PATH = "44'/60'/0'/0/0";
export type LedgerSignature = { r: string; s: string; v: number };
export function ledgerUnsigned(request: TransactionRequest) {
  if (typeof request.to !== 'string' || (request.data != null && typeof request.data !== 'string')) throw new Error('Ledger requires a literal recipient and hex calldata.');
  const tx = Transaction.from(request as TransactionLike<string>);
  if (tx.chainId !== 11155111n || tx.type !== 2 || tx.data !== '0x' || !tx.to || tx.to === ZeroAddress || tx.value <= 0n
    || tx.accessList?.length || tx.authorizationList?.length || tx.isSigned()) throw new Error('Ledger supports plain Sepolia ETH transfers only.');
  return getBytes(tx.unsignedSerialized);
}
export function ledgerSigned(request: TransactionRequest, signature: LedgerSignature, sender: string) {
  ledgerUnsigned(request);
  if (typeof request.to !== 'string' || (request.data != null && typeof request.data !== 'string')) throw new Error('Ledger requires a literal recipient and hex calldata.');
  const tx = Transaction.from(request as TransactionLike<string>);
  tx.signature = Signature.from(signature);
  assertSignedMatchesReview(tx.serialized, request, sender);
  return tx.serialized;
}

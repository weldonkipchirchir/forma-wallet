/** Translate library failures before showing them in a wallet notice. */
export function walletErrorMessage(error: unknown): string {
  const fallback = 'Something went wrong. Please try again.';
  if (!(error instanceof Error)) return fallback;
  if (/^incorrect password(?:\s|$)/i.test(error.message)) return 'Incorrect password. Please try again.';
  const code = (error as Error & { code?: unknown }).code;
  if (code === 'NETWORK_ERROR' || code === 'SERVER_ERROR' || code === 'TIMEOUT') {
    return 'Unable to connect to Sepolia. Check your connection and try again.';
  }
  // Ethers diagnostic messages can include arguments, RPC payloads and URLs.
  if (code !== undefined || /\b(?:argument|value|payload|request|version|code)=/.test(error.message)) return fallback;
  return error.message || fallback;
}

export type FeePreset = 'slow' | 'market' | 'fast';
export type FeeQuote = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

const ceilDiv = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor;
const scaled = (value: bigint, numerator: bigint, denominator: bigint) => value <= 0n ? 0n : ceilDiv(value * numerator, denominator);
const atLeast = (value: bigint, floor: bigint) => value > floor ? value : floor;

export function feePresets(suggested: FeeQuote): Record<FeePreset, FeeQuote> {
  if (suggested.maxFeePerGas <= 0n || suggested.maxPriorityFeePerGas < 0n) throw new Error('Network fee suggestion is unavailable.');
  if (suggested.maxPriorityFeePerGas > suggested.maxFeePerGas) throw new Error('Network fee suggestion is inconsistent.');
  const tip = suggested.maxPriorityFeePerGas;
  const slowTip = tip > 0n ? atLeast(scaled(tip, 8n, 10n), 1n) : 0n;
  const slowMax = atLeast(suggested.maxFeePerGas - (tip - slowTip), slowTip);
  const fastTip = tip > 0n ? atLeast(scaled(tip, 3n, 2n), 1n) : 0n;
  const fastMax = atLeast(scaled(suggested.maxFeePerGas, 13n, 10n), fastTip);
  return {
    slow: { maxFeePerGas: slowMax, maxPriorityFeePerGas: slowTip },
    market: { maxFeePerGas: suggested.maxFeePerGas, maxPriorityFeePerGas: tip },
    fast: { maxFeePerGas: fastMax, maxPriorityFeePerGas: fastTip },
  };
}

// Forma policy: bump both EIP-1559 fee fields by at least 12.5%. This is not
// asserted to be MetaMask's threshold; see REA-METAMASK-FEATURE-SPEC.
export function replacementFees(original: FeeQuote): FeeQuote {
  if (original.maxFeePerGas <= 0n || original.maxPriorityFeePerGas < 0n) throw new Error('Original network fee is unavailable.');
  const tip = original.maxPriorityFeePerGas > 0n ? original.maxPriorityFeePerGas : 1n;
  const maxPriorityFeePerGas = ceilDiv(tip * 9n, 8n);
  const maxFeePerGas = atLeast(ceilDiv(original.maxFeePerGas * 9n, 8n), maxPriorityFeePerGas);
  return { maxFeePerGas, maxPriorityFeePerGas };
}

export function replacementTotal(gasLimit: bigint, quote: FeeQuote) {
  return gasLimit * quote.maxFeePerGas;
}

export function formatGwei(value: bigint) {
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

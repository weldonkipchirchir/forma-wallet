import {networkAsset,type NetworkId} from './network-context';
import {networkLabel} from './network-environment';
export function feeGuidance(network:NetworkId){const symbol=networkAsset(network).symbol;
  return `<details class="fee-guidance"><summary>Network fees · paid in ${symbol}</summary><p>Keep some ${symbol} on ${networkLabel(network)} to cover network fees. USDT is a token balance, not a universal fee balance. Token-paid fees require a compatible relayer or paymaster; Forma does not currently provide one.</p><ol class="flow-diagram" aria-label="How network fees work"><li><strong>You choose an asset</strong><span>For example, USDT</span></li><li><strong>You keep the fee asset</strong><span>${symbol} on this network</span></li><li><strong>You review the transfer</strong><span>Amount, recipient and fees</span></li></ol></details>`;
}

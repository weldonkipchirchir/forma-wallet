import { evmNetworks, isAdditionalEvm, type EvmNetworkId } from './evm-networks';
export type NetworkId = 'eth' | 'btc' | 'sol' | 'sol-mainnet' | 'tron' | EvmNetworkId;
export const networkAssets = {
  eth: { name: 'Ethereum', symbol: 'ETH', pair: 'ETHUSDT', network: 'Ethereum Sepolia' },
  btc: { name: 'Bitcoin', symbol: 'BTC', pair: 'BTCUSDT', network: 'Bitcoin Testnet3' },
  sol: { name: 'Solana', symbol: 'SOL', pair: 'SOLUSDT', network: 'Solana Devnet' },
  'sol-mainnet': { name: 'Solana', symbol: 'SOL', pair: 'SOLUSDT', network: 'Solana Mainnet' },
  tron: { name: 'TRON', symbol: 'TRX', pair: 'TRXUSDT', network: 'TRON Nile' },
} as const;
export function networkAsset(id: NetworkId) { return isAdditionalEvm(id) ? { ...evmNetworks[id], pair: `${evmNetworks[id].symbol}USDT` } : networkAssets[id]; }
export const networkIds: NetworkId[] = ['eth', 'btc', 'sol', 'sol-mainnet', 'tron', ...Object.keys(evmNetworks) as EvmNetworkId[]];
export function isNetworkId(value: string): value is NetworkId { return value === 'eth' || value === 'btc' || value === 'sol' || value === 'sol-mainnet' || value === 'tron' || isAdditionalEvm(value); }
export function savedNetwork(value: string | null): NetworkId { return value && isNetworkId(value) ? value : 'eth'; }
export function usesNativeWorkspace(id: NetworkId, page: string) {
  return (id === 'btc' || id === 'sol') && (['overview', 'portfolio', 'transfer', 'activity'].includes(page) || (id === 'sol' && page === 'tokens'));
}
export function supportsPage(id: NetworkId, page: string) {
  if (page === 'networks' || page === 'cards') return true;
  if (id === 'sol-mainnet') return ['overview','portfolio','transfer','tokens','activity','market','settings'].includes(page);
  if (id === 'tron') return ['overview', 'portfolio', 'transfer', 'tokens', 'activity', 'market', 'settings'].includes(page);
  if (isAdditionalEvm(id)) return ['overview', 'portfolio', 'transfer', 'activity', 'tokens', 'settings'].includes(page);
  return id === 'eth' || (id === 'sol' && page === 'tokens') || !['tokens', 'ledger'].includes(page);
}
export function networkHeading(id: NetworkId, page: string) {
  const asset = networkAsset(id);
  const labels: Record<string, string> = { overview: 'wallet', portfolio: 'holdings', transfer: 'send & receive', activity: 'activity', market: 'market', tokens: 'tokens', contacts: 'contacts', watch: 'watch-only' };
  return `${asset.name} ${labels[page] || 'wallet'}`;
}

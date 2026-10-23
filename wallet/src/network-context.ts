export type NetworkId = 'eth' | 'btc' | 'sol';
export const networkAssets = {
  eth: { name: 'Ethereum', symbol: 'ETH', pair: 'ETHUSDT', network: 'Ethereum Sepolia' },
  btc: { name: 'Bitcoin', symbol: 'BTC', pair: 'BTCUSDT', network: 'Bitcoin Testnet3' },
  sol: { name: 'Solana', symbol: 'SOL', pair: 'SOLUSDT', network: 'Solana Devnet' },
} as const;
export function networkAsset(id: NetworkId) { return networkAssets[id]; }
export function savedNetwork(value: string | null): NetworkId { return value === 'btc' || value === 'sol' ? value : 'eth'; }
export function usesNativeWorkspace(id: NetworkId, page: string) {
  return id !== 'eth' && (['overview', 'portfolio', 'transfer', 'activity'].includes(page) || (id === 'sol' && page === 'tokens'));
}
export function supportsPage(id: NetworkId, page: string) {
  return id === 'eth' || (id === 'sol' && page === 'tokens') || !['tokens', 'ledger'].includes(page);
}
export function networkHeading(id: NetworkId, page: string) {
  const asset = networkAsset(id);
  const labels: Record<string, string> = { overview: 'wallet', portfolio: 'holdings', transfer: 'send & receive', activity: 'activity', market: 'market', tokens: 'tokens', contacts: 'contacts', watch: 'watch-only' };
  return `${asset.name} ${labels[page] || 'wallet'}`;
}

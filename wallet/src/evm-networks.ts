export const evmNetworks = {
  base: { name: 'Base', network: 'Base Sepolia', chainId: 84532, rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' },
  arbitrum: { name: 'Arbitrum', network: 'Arbitrum Sepolia', chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io' },
  optimism: { name: 'Optimism', network: 'OP Sepolia', chainId: 11155420, rpc: 'https://sepolia.optimism.io', explorer: 'https://optimism-sepolia.blockscout.com' },
  robinhood: { name: 'Robinhood Chain', network: 'Robinhood Chain Testnet', chainId: 46630, rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' },
} as const;
export type EvmNetworkId = keyof typeof evmNetworks;
export type EvmNetwork = typeof evmNetworks[EvmNetworkId];
export function isAdditionalEvm(id: string): id is EvmNetworkId { return Object.prototype.hasOwnProperty.call(evmNetworks, id); }
export function requireEvmNetwork(expected: EvmNetworkId, actual: bigint) {
  if (actual !== BigInt(evmNetworks[expected].chainId)) throw new Error('Wrong network returned by RPC. Signing is blocked.');
}

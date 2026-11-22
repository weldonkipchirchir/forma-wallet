type PresetInput = { name: string; network: string; chainId: number; symbol: string; rpc: string; explorer: string; docs: string };
const testnet = <const T extends PresetInput>(preset: T) => Object.freeze({ ...preset, decimals: 18, testnet: true, transactionType: 2 } as const);

// Operator-reviewed HTTPS endpoints, not a remote/untrusted network-list import.
// Public RPCs can be rate limited. Every connection must still verify eth_chainId.
export const evmNetworks = Object.freeze({
  base: testnet({ name: 'Base', network: 'Base Sepolia', chainId: 84532, symbol: 'ETH', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org', docs: 'https://docs.base.org' }),
  arbitrum: testnet({ name: 'Arbitrum', network: 'Arbitrum Sepolia', chainId: 421614, symbol: 'ETH', rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io', docs: 'https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers' }),
  optimism: testnet({ name: 'Optimism', network: 'OP Sepolia', chainId: 11155420, symbol: 'ETH', rpc: 'https://sepolia.optimism.io', explorer: 'https://optimism-sepolia.blockscout.com', docs: 'https://docs.optimism.io' }),
  robinhood: testnet({ name: 'Robinhood Chain', network: 'Robinhood Chain Testnet', chainId: 46630, symbol: 'ETH', rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com', docs: 'https://docs.robinhood.com/chain/add-network-to-wallet/' }),
  polygon: testnet({ name: 'Polygon', network: 'Polygon Amoy', chainId: 80002, symbol: 'POL', rpc: 'https://polygon-amoy.drpc.org', explorer: 'https://amoy.polygonscan.com', docs: 'https://docs.polygon.technology/pos/reference/rpc-endpoints' }),
  avalanche: testnet({ name: 'Avalanche', network: 'Avalanche Fuji C-Chain', chainId: 43113, symbol: 'AVAX', rpc: 'https://api.avax-test.network/ext/bc/C/rpc', explorer: 'https://testnet.snowtrace.io', docs: 'https://build.avax.network/docs/primary-network' }),
  linea: testnet({ name: 'Linea', network: 'Linea Sepolia', chainId: 59141, symbol: 'ETH', rpc: 'https://rpc.sepolia.linea.build', explorer: 'https://sepolia.lineascan.build', docs: 'https://docs.linea.build/network/build/connect' }),
  unichain: testnet({ name: 'Unichain', network: 'Unichain Sepolia', chainId: 1301, symbol: 'ETH', rpc: 'https://sepolia.unichain.org', explorer: 'https://sepolia.uniscan.xyz', docs: 'https://developers.uniswap.org/docs/unichain/technical-information/network-information' }),
  soneium: testnet({ name: 'Soneium', network: 'Soneium Minato', chainId: 1946, symbol: 'ETH', rpc: 'https://rpc.minato.soneium.org', explorer: 'https://soneium-minato.blockscout.com', docs: 'https://docs.soneium.org/docs/builders/overview' }),
  worldchain: testnet({ name: 'World Chain', network: 'World Chain Sepolia', chainId: 4801, symbol: 'ETH', rpc: 'https://worldchain-sepolia.g.alchemy.com/public', explorer: 'https://worldchain-sepolia.explorer.alchemy.com', docs: 'https://github.com/ethereum-optimism/superchain-registry/blob/main/chainList.json' }),
  ink: testnet({ name: 'Ink', network: 'Ink Sepolia', chainId: 763373, symbol: 'ETH', rpc: 'https://rpc-gel-sepolia.inkonchain.com', explorer: 'https://explorer-sepolia.inkonchain.com', docs: 'https://docs.inkonchain.com/general/network-information' }),
} as const);
export type EvmNetworkId = keyof typeof evmNetworks;
export type EvmNetwork = typeof evmNetworks[EvmNetworkId];
export function isAdditionalEvm(id: string): id is EvmNetworkId { return Object.prototype.hasOwnProperty.call(evmNetworks, id); }
export function requireEvmNetwork(expected: EvmNetworkId, actual: bigint) {
  if (!isAdditionalEvm(expected) || actual !== BigInt(evmNetworks[expected].chainId)) throw new Error('Wrong network returned by RPC. Signing is blocked.');
}

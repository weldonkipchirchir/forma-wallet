type PresetInput = { name: string; network: string; chainId: number; symbol: string; rpc: string; explorer: string; docs: string };
const testnet = <const T extends PresetInput>(preset: T) => Object.freeze({ ...preset, decimals: 18, testnet: true, transactionType: 2 } as const);
const mainnet = <const T extends PresetInput>(preset: T, transactionType: 0 | 2 = 2) => Object.freeze({ ...preset, decimals: 18, testnet: false, transactionType } as const);

// Operator-reviewed HTTPS endpoints, not a remote/untrusted network-list import.
// Public RPCs can be rate limited. Every connection must still verify eth_chainId.
export const evmNetworks = Object.freeze({
  'worldchain-mainnet': mainnet({name:'World Chain',network:'World Chain Mainnet',chainId:480,symbol:'ETH',rpc:'https://worldchain-mainnet.g.alchemy.com/public',explorer:'https://worldchain-mainnet.explorer.alchemy.com',docs:'https://github.com/ethereum-optimism/superchain-registry/blob/main/superchain/configs/mainnet/worldchain.toml'}),
  'soneium-mainnet': mainnet({name:'Soneium',network:'Soneium Mainnet',chainId:1868,symbol:'ETH',rpc:'https://rpc.soneium.org',explorer:'https://soneium.blockscout.com',docs:'https://docs.soneium.org/docs/builders/overview'}),
  'gnosis-mainnet': mainnet({name:'Gnosis',network:'Gnosis Mainnet',chainId:100,symbol:'XDAI',rpc:'https://rpc.gnosischain.com',explorer:'https://gnosisscan.io',docs:'https://docs.gnosischain.com/about/networks/mainnet/'}),
  'sonic-mainnet': mainnet({name:'Sonic',network:'Sonic Mainnet',chainId:146,symbol:'S',rpc:'https://rpc.soniclabs.com',explorer:'https://sonicscan.org',docs:'https://docs.soniclabs.com/sonic/build-on-sonic/getting-started'}),
  'celo-mainnet': mainnet({name:'Celo',network:'Celo Mainnet',chainId:42220,symbol:'CELO',rpc:'https://forno.celo.org',explorer:'https://celoscan.io',docs:'https://docs.celo.org/learn/network/overview'}),
  'scroll-mainnet': mainnet({name:'Scroll',network:'Scroll Mainnet',chainId:534352,symbol:'ETH',rpc:'https://rpc.scroll.io',explorer:'https://scrollscan.com',docs:'https://docs.scroll.io/en/developers/'}),
  'ethereum-mainnet': mainnet({ name: 'Ethereum', network: 'Ethereum Mainnet', chainId: 1, symbol: 'ETH', rpc: 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io', docs: 'https://ethereum.publicnode.com/' }),
  'bnb-mainnet': mainnet({ name: 'BNB Smart Chain', network: 'BNB Smart Chain Mainnet', chainId: 56, symbol: 'BNB', rpc: 'https://bsc-dataseed.bnbchain.org', explorer: 'https://bscscan.com', docs: 'https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/' }, 0),
  'polygon-mainnet': mainnet({ name: 'Polygon', network: 'Polygon Mainnet', chainId: 137, symbol: 'POL', rpc: 'https://polygon.drpc.org', explorer: 'https://polygonscan.com', docs: 'https://docs.polygon.technology/pos/reference/rpc-endpoints/' }),
  'avalanche-mainnet': mainnet({ name: 'Avalanche', network: 'Avalanche C-Chain Mainnet', chainId: 43114, symbol: 'AVAX', rpc: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io', docs: 'https://docs.avax.network/docs/primary-network' }),
  'base-mainnet': mainnet({ name: 'Base', network: 'Base Mainnet', chainId: 8453, symbol: 'ETH', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org', docs: 'https://docs.base.org/get-started/connect-to-base' }),
  'arbitrum-mainnet': mainnet({ name: 'Arbitrum', network: 'Arbitrum One Mainnet', chainId: 42161, symbol: 'ETH', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io', docs: 'https://docs.arbitrum.io/chain-info' }),
  'optimism-mainnet': mainnet({ name: 'Optimism', network: 'OP Mainnet', chainId: 10, symbol: 'ETH', rpc: 'https://mainnet.optimism.io', explorer: 'https://optimistic.etherscan.io', docs: 'https://github.com/ethereum-optimism/superchain-registry/blob/main/superchain/configs/mainnet/op.toml' }),
  'linea-mainnet': mainnet({ name: 'Linea', network: 'Linea Mainnet', chainId: 59144, symbol: 'ETH', rpc: 'https://rpc.linea.build', explorer: 'https://lineascan.build', docs: 'https://docs.linea.build/network/build/connect' }),
  'unichain-mainnet': mainnet({ name: 'Unichain', network: 'Unichain Mainnet', chainId: 130, symbol: 'ETH', rpc: 'https://mainnet.unichain.org', explorer: 'https://uniscan.xyz', docs: 'https://developers.uniswap.org/docs/unichain/technical-information/network-information' }),
  'ink-mainnet': mainnet({ name: 'Ink', network: 'Ink Mainnet', chainId: 57073, symbol: 'ETH', rpc: 'https://rpc-gel.inkonchain.com', explorer: 'https://explorer.inkonchain.com', docs: 'https://docs.inkonchain.com/general/network-information' }),
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

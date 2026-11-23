import {isMainnetNetwork,networkAsset,type NetworkId} from './network-context';

const brands:Record<string,string>={eth:'ethereum',ethereum:'ethereum',btc:'bitcoin',sol:'solana',tron:'tron',bnb:'smartchain',polygon:'polygon',avalanche:'avalanchec',base:'base',arbitrum:'arbitrum',optimism:'optimism',linea:'linea',gnosis:'xdai',sonic:'sonic',celo:'celo',scroll:'scroll',robinhood:'robinhoodchain',ink:'ink',soneium:'soneium',worldchain:'worldchain',unichain:'unichain'};
/** Chain identity is independent of the chain's gas token. Paths are local and allowlisted. */
export function networkIconPath(id:NetworkId){const brand=brands[id.replace(/-mainnet$/,'')];return `/assets/networks/${brand}.${brand==='ink'||brand==='soneium'?'svg':brand==='unichain'?'ico':'png'}`;}
export function networkDisplayName(id:NetworkId){return id==='optimism-mainnet'?'Optimism':isMainnetNetwork(id)?networkAsset(id).network.replace(/\bmainnet\b/gi,'').replace(/\s+/g,' ').trim():networkAsset(id).network;}
export function networkLogo(id:NetworkId){return `<img class="network-logo" src="${networkIconPath(id)}" width="28" height="28" alt="${networkAsset(id).name} network logo" loading="lazy">`;}

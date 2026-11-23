import {networkIds,networkAsset,isMainnetNetwork,type NetworkId} from './network-context';
export function environmentNetwork(current:NetworkId,live:boolean):NetworkId {
  if(isMainnetNetwork(current)===live)return current;
  return networkIds.find(id=>isMainnetNetwork(id)===live&&networkAsset(id).name===networkAsset(current).name)??(live?'ethereum-mainnet':'eth');
}
export {networkDisplayName as networkLabel} from './network-identity';

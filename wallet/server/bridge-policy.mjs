import {getAddress,ZeroAddress} from 'ethers';
import {base58,bech32} from '@scure/base';
export const BRIDGE_NETWORKS=Object.freeze([
  ['ethereum-mainnet',1,'ETH',18,'evm'],['base-mainnet',8453,'ETH',18,'evm'],['arbitrum-mainnet',42161,'ETH',18,'evm'],['optimism-mainnet',10,'ETH',18,'evm'],['polygon-mainnet',137,'POL',18,'evm'],['avalanche-mainnet',43114,'AVAX',18,'evm'],['bnb-mainnet',56,'BNB',18,'evm'],['linea-mainnet',59144,'ETH',18,'evm'],['unichain-mainnet',130,'ETH',18,'evm'],['ink-mainnet',57073,'ETH',18,'evm'],['worldchain-mainnet',480,'ETH',18,'evm'],['soneium-mainnet',1868,'ETH',18,'evm'],['gnosis-mainnet',100,'XDAI',18,'evm'],['sonic-mainnet',146,'S',18,'evm'],['celo-mainnet',42220,'CELO',18,'evm'],['scroll-mainnet',534352,'ETH',18,'evm'],['sol-mainnet',792703809,'SOL',9,'svm'],['btc-mainnet',8253038,'BTC',8,'bvm']
].map(([id,chainId,symbol,decimals,vm])=>Object.freeze({id,chainId,symbol,decimals,vm,native:vm==='evm'?ZeroAddress:vm==='svm'?'11111111111111111111111111111111':'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8'})));
export function bridgeNetwork(id){const network=BRIDGE_NETWORKS.find(network=>network.id===id);if(!network)throw Error('Unsupported bridge network.');return network;}
export function validBridgeAddress(value,vm){if(typeof value!=='string'||value.length>100)throw Error('Invalid public address.');if(vm==='evm'){const address=getAddress(value);if(address===ZeroAddress)throw Error('Zero recipient is not allowed.');return address;}if(vm==='svm'){if(base58.decode(value).length!==32)throw Error('Invalid Solana address.');return value;}const decoded=bech32.decode(value);if(decoded.prefix!=='bc'||decoded.words[0]!==0||bech32.fromWords(decoded.words.slice(1)).length!==20)throw Error('Only Bitcoin native SegWit receiving addresses are supported.');return value.toLowerCase();}
export function bridgeRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['from','to','amount','user','recipient'].includes(key)))throw Error('Invalid bridge request.');
  const from=bridgeNetwork(value.from),to=bridgeNetwork(value.to);if(from.id===to.id||from.vm!=='evm')throw Error('Cross-chain signing currently requires an EVM source and a different destination.');
  if(typeof value.amount!=='string'||!/^\d{1,30}$/.test(value.amount)||BigInt(value.amount)<=0n)throw Error('Invalid native asset amount.');
  return{from,to,amount:value.amount,user:validBridgeAddress(value.user,'evm'),recipient:validBridgeAddress(value.recipient,to.vm)};
}

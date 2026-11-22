import { getAddress } from 'ethers';
import type { Token } from './token-data';
import { evmNetworks, type EvmNetworkId } from './evm-networks';

export type ListedToken = Token & { source: string };
const circle = 'https://developers.circle.com/stablecoins/usdc-contract-addresses';
const tether = 'https://tether.to/en/supported-protocols/';
const usdc: Record<number, string> = {
  1:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 137:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  43114:'0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',8453:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  42161:'0xaf88d065e77c8cc2239327c5edb3a432268e5831',10:'0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  59144:'0x176211869ca2b568f2a7d4ee941e073a821ee1ff',130:'0x078d782b760474a361dda0af3839290b0ef57ad6',
  57073:'0x2d270e6886d130d724215a266106e6832161eaed',
};
const usdt: Record<number,string> = {1:'0xdac17f958d2ee523a2206206994597c13d831ec7',43114:'0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7'};
export function listedMainnetTokens(network: EvmNetworkId): ListedToken[] {
  const config=evmNetworks[network]; if(config.testnet)return [];
  const rows:ListedToken[]=[];
  if(usdc[config.chainId])rows.push({address:getAddress(usdc[config.chainId]),symbol:'USDC',name:'USD Coin',decimals:6,source:circle});
  if(usdt[config.chainId])rows.push({address:getAddress(usdt[config.chainId]),symbol:'USDT',name:'Tether USD',decimals:6,source:tether});
  return rows;
}
export function listedMainnetToken(network:EvmNetworkId,address:string) {return listedMainnetTokens(network).find(token=>token.address.toLowerCase()===address.toLowerCase());}
export function mergeListedTokens(network:EvmNetworkId,tracked:Token[]):Token[] {
  const known=listedMainnetTokens(network), addresses=new Set(known.map(token=>token.address.toLowerCase()));
  // Stored self-declared metadata never overrides pinned issuer metadata.
  return [...known,...tracked.filter(token=>!addresses.has(token.address.toLowerCase()))].slice(0,250);
}

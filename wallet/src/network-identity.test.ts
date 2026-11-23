import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {networkIds,isMainnetNetwork} from './network-context';
import {networkDisplayName,networkIconPath} from './network-identity';

describe('reviewed network identities',()=>{
  it('has a local brand icon for every supported network without confusing ETH gas with the chain',()=>{
    for(const id of networkIds){const path=networkIconPath(id);expect(path).toMatch(/^\/assets\/networks\/[a-z]+\.(png|svg|ico)$/);expect(existsSync(new URL(`../public${path}`,import.meta.url))).toBe(true);}
    expect(networkIconPath('base-mainnet')).not.toBe(networkIconPath('ethereum-mainnet'));
    expect(networkIconPath('arbitrum')).toBe(networkIconPath('arbitrum-mainnet'));
  });
  it('omits Mainnet from live network names while retaining test environment identity',()=>{
    for(const id of networkIds.filter(isMainnetNetwork))expect(networkDisplayName(id)).not.toMatch(/mainnet/i);
    expect(networkDisplayName('sol')).toBe('Solana Devnet');expect(networkDisplayName('eth')).toBe('Ethereum Sepolia');
  });
  it('bundles inert SVG brand marks without external resources or active content',()=>{
    for(const file of ['ink.svg','soneium.svg'])expect(readFileSync(new URL(`../public/assets/networks/${file}`,import.meta.url),'utf8')).not.toMatch(/<script|foreignObject|\bon\w+=|(?:href|src)\s*=/i);
  });
});

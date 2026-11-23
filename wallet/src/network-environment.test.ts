import {describe,it,expect} from 'vitest';
import {environmentNetwork,networkLabel} from './network-environment';
import {isMainnetNetwork} from './network-context';
import {joinRecoveryWords} from './recovery-words';
describe('global wallet environment',()=>{
  it('keeps paired chains and isolates environments without inventing unsupported networks',()=>{
    for(const [test,live] of [['eth','ethereum-mainnet'],['sol','sol-mainnet'],['btc','btc-mainnet'],['tron','tron-mainnet'],['base','base-mainnet']] as const){expect(environmentNetwork(test,true)).toBe(live);expect(environmentNetwork(live,false)).toBe(test);expect(environmentNetwork(live,true)).toBe(live);}
    expect(environmentNetwork('gnosis-mainnet',false)).toBe('eth');expect(isMainnetNetwork(environmentNetwork('robinhood',true))).toBe(true);expect(networkLabel('sol-mainnet')).toBe('Solana');
  });
  it('preserves recovery word order while normalizing spacing/case',()=>{expect(joinRecoveryWords([' Abandon ','ABOUT'])).toBe('abandon about');});
});

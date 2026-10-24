import { describe,it,expect } from 'vitest';
import { publicAccount,parsePublicAccounts,publicAccountsKey } from './native-public';
describe('native public accounts',()=>{
  const btc='tb1qhxezp6gdgh2t9ypu6j252gsfmqckpzksd8twn6';
  const sol='6kVTcNchJxMmkwnLaEktzXyCZpoYi8KUAvQ5xGHBXDjJ';
  it('validates addresses by network and rejects program addresses',()=>{
    expect(publicAccount('btc','Test',btc).address).toBe(btc);
    expect(publicAccount('sol','Test',sol).address).toBe(sol);
    expect(()=>publicAccount('sol','Test',btc)).toThrow();
    expect(()=>publicAccount('btc','Test',sol)).toThrow();
    expect(()=>publicAccount('sol','Test','11111111111111111111111111111111')).toThrow();
  });
  it('rejects unsafe names, malformed records and duplicates',()=>{
    expect(()=>publicAccount('sol','<script>',sol)).toThrow();
    expect(()=>publicAccount('sol','Trusted\u202e recipient',sol)).toThrow();
    expect(parsePublicAccounts('sol',[null,{name:'A',address:sol},{name:'B',address:sol},{name:'X',address:btc}])).toEqual([{name:'A',address:sol}]);
  });
  it('separates networks, contacts by owner and watch accounts from contacts',()=>{
    expect(publicAccountsKey('btc','contacts','A')).not.toBe(publicAccountsKey('sol','contacts','A'));
    expect(publicAccountsKey('sol','contacts','A')).not.toBe(publicAccountsKey('sol','contacts','B'));
    expect(publicAccountsKey('sol','watch','A')).not.toBe(publicAccountsKey('sol','contacts','A'));
  });
});

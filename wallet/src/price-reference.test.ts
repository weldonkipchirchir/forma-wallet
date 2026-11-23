import {afterEach,describe,it,expect,vi} from 'vitest';
import {readUsdReference} from './price-reference';
afterEach(()=>vi.unstubAllGlobals());
describe('independent USD references',()=>{
  it('uses Kraken when Coinbase is unavailable, without assuming a stablecoin peg',async()=>{
    const fetch=vi.fn(async(url:string)=>{if(url.startsWith('https://api.kraken.com'))return new Response(JSON.stringify({error:[],result:{USDTZUSD:{c:['0.997','1']}}}));throw Error('blocked');});vi.stubGlobal('fetch',fetch);
    await expect(readUsdReference('USDT',new AbortController().signal)).resolves.toBe(.997);expect(fetch.mock.calls.every(([url])=>!url.includes('wallet')&&!url.includes('address'))).toBe(true);
  });
  it('validates the retail spot pair and never accepts another currency as USD',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.startsWith('https://api.coinbase.com')?new Response(JSON.stringify({data:{base:'SOL',currency:'USD',amount:'125.25'}})):new Response('{}',{status:503})));
    await expect(readUsdReference('SOL',new AbortController().signal)).resolves.toBe(125.25);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.startsWith('https://api.coinbase.com')?new Response(JSON.stringify({data:{base:'BTC',currency:'EUR',amount:'125.25'}})):new Response('{}',{status:503})));
    await expect(readUsdReference('SOL',new AbortController().signal)).rejects.toThrow('temporarily unavailable');
  });
  it('rejects mismatched Kraken results, invalid numbers and unreviewed symbols',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({error:[],result:{XBTUSD:{c:['100','1']}}})));vi.stubGlobal('fetch',fetch);await expect(readUsdReference('SOL',new AbortController().signal)).rejects.toThrow();fetch.mockClear();await expect(readUsdReference('../secret',new AbortController().signal)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
});

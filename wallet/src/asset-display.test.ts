import { describe, expect, it, vi, afterEach } from 'vitest';
import { assetLogo, assetTable, readNativeReference } from './asset-display';
afterEach(() => vi.unstubAllGlobals());
describe('asset identity and reference display', () => {
  it('does not award known issuer logos to self-declared symbols', () => {
    expect(assetLogo('USDT')).toContain('/token.svg');
    expect(assetLogo('ETH', true)).toContain('/eth.svg');
    expect(assetLogo('<script>', true)).not.toContain('<script>');
  });
  it('reports partial valuation and preserves unavailable balances', () => {
    const html = assetTable([{id:'native',symbol:'ETH',name:'Sepolia',amount:'2',usd:10,verified:true},{id:'fake',symbol:'USDT',name:'<img>',amount:'1000'}],false);
    expect(html).toContain('$10.00'); expect(html).toContain('1/2 assets priced');
    expect(html).toContain('Unavailable'); expect(html).toContain('&lt;img&gt;');
    expect(html).not.toContain('$1,000');
  });
  it('hides totals and quantities together', () => {
    const html=assetTable([{id:'n',symbol:'ETH',name:'test',amount:'123.456',usd:987.65}],true);
    expect(html).not.toContain('123.456'); expect(html).not.toContain('987.65');
  });
  it('refuses arbitrary price lookup identifiers and invalid prices',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{"price":"NaN"}',{status:200})); vi.stubGlobal('fetch',fetch);
    await expect(readNativeReference('../secret',new AbortController().signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
    await expect(readNativeReference('ETH',new AbortController().signal)).rejects.toThrow('Invalid USD');
  });
});

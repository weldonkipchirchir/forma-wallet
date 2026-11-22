import { describe, expect, it, vi, afterEach } from 'vitest';
import { assetLogo, assetTable, readNativeReference, referenceDollars } from './asset-display';
import { holdingMatches } from './holdings-controls';
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
    expect(html).toContain('data-holdings-zero disabled');
    expect(html).not.toContain('data-holding-zero="true"');
  });
  it('searches names and contracts without hiding unavailable balances as zero', () => {
    expect(holdingMatches('USDT 0x123abc', '123ABC', false, true)).toBe(true);
    expect(holdingMatches('USDT', '', true, true)).toBe(false);
    expect(holdingMatches('ETH', 'sol', false, false)).toBe(false);
    const html = assetTable([{id:'<script>',symbol:'TST',name:'Unknown',amount:'0.000000000000000001'},{id:'zero',symbol:'ZERO',name:'Zero',amount:'0.0'}],false);
    expect(html).toContain('data-holding-zero="false"');
    expect(html).toContain('data-holding-zero="true"');
    expect(html).not.toContain('<script>');
  });
  it('keeps nonzero sub-cent references distinct from zero', () => {
    expect(referenceDollars(0)).toBe('$0.00');
    expect(referenceDollars(0.00034)).toBe('$0.00034');
    expect(referenceDollars(0.00000001)).toBe('<$0.000001');
    expect(referenceDollars(Infinity)).toBe('Unavailable');
  });
  it('refuses arbitrary price lookup identifiers and invalid prices',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{"price":"NaN"}',{status:200})); vi.stubGlobal('fetch',fetch);
    await expect(readNativeReference('../secret',new AbortController().signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
    await expect(readNativeReference('ETH',new AbortController().signal)).rejects.toThrow('Invalid USD');
  });
});

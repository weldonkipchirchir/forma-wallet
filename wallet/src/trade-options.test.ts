import {describe,it,expect} from 'vitest';
import {BUY_USDT_URL} from './trade-options';
import {allocationRows,allocationChart} from './portfolio-allocation';
import {assetLogo} from './asset-display';

it('pins purchase handoff without putting wallet or card details in the URL',()=>{const url=new URL(BUY_USDT_URL);expect(url.origin).toBe('https://www.moonpay.com');expect(url.search).toBe('');});
describe('current allocation and chain overlays',()=>{
  it('uses priced positive holdings only and conceals allocation when balances are hidden',()=>{
    const rows=[{network:'sol-mainnet' as const,usd:30},{network:'ethereum-mainnet' as const,usd:70},{network:'sol-mainnet' as const,usd:undefined},{network:'base-mainnet' as const,usd:NaN}];
    expect(allocationRows(rows).map(row=>row.percent)).toEqual([70,30]);expect(allocationChart(rows,true)).not.toContain('70');expect(allocationRows([{network:'sol-mainnet',usd:0}])).toEqual([]);
  });
  it('shows the chain badge independently of unverified token identity',()=>{const html=assetLogo('USDT',false,'base-mainnet');expect(html).toContain('/token.svg');expect(html).toContain('/networks/base.png');expect(html).toContain('asset-chain-overlay');});
});

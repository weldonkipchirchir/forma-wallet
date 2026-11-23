import {referenceDollars} from './asset-display';
import {networkLabel} from './network-environment';
import type {NetworkId} from './network-context';
type PricedHolding={network:NetworkId;usd?:number};
export function allocationRows(rows:PricedHolding[]){
  const totals=new Map<NetworkId,number>();for(const row of rows)if(row.usd!==undefined&&Number.isFinite(row.usd)&&row.usd>0)totals.set(row.network,(totals.get(row.network)||0)+row.usd);
  const total=[...totals.values()].reduce((a,b)=>a+b,0);if(!Number.isFinite(total)||total<=0)return[];
  return [...totals].sort((a,b)=>b[1]-a[1]).map(([network,value])=>({network,value,percent:value/total*100}));
}
export function allocationChart(rows:PricedHolding[],hidden:boolean){
  if(hidden)return '<p class="allocation-empty">Show balances to view your allocation.</p>';
  const parts=allocationRows(rows);if(!parts.length)return '<p class="allocation-empty">Your allocation will appear when balances and prices are available.</p>';
  const visible=parts.slice(0,5).map(part=>({...part,label:networkLabel(part.network)}));
  const rest=parts.slice(5);const chart=[...visible,...(rest.length?[{label:`Other networks (${rest.length})`,value:rest.reduce((sum,part)=>sum+part.value,0),percent:rest.reduce((sum,part)=>sum+part.percent,0)}]:[])];
  return `<ol class="allocation-bars" aria-label="Network allocation of priced assets">${chart.map((part,index)=>`<li><span>${part.label}</span><strong>${part.percent.toFixed(1)}% <small>${referenceDollars(part.value)}</small></strong><span class="allocation-track" aria-hidden="true"><i class="allocation-color-${index%4}" style="width:${Math.max(.3,part.percent)}%"></i></span></li>`).join('')}</ol>`;
}

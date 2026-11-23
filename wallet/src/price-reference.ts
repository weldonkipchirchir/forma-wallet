import {boundedJson} from './bounded-response';
const products:Record<string,string>={ETH:'ETH-USD',BTC:'BTC-USD',SOL:'SOL-USD',TRX:'TRX-USD',POL:'POL-USD',AVAX:'AVAX-USD',BNB:'BNB-USD',USDT:'USDT-USD',USDC:'USDC-USD'};
const kraken:Record<string,string[]>={ETH:['ETHUSD','XETHZUSD'],BTC:['XBTUSD','XXBTZUSD'],SOL:['SOLUSD'],TRX:['TRXUSD'],POL:['POLUSD'],AVAX:['AVAXUSD'],BNB:['BNBUSD'],USDT:['USDTUSD','USDTZUSD'],USDC:['USDCUSD','USDCZUSD']};
function positive(value:unknown){if(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value))throw Error('Invalid price.');const price=Number(value);if(!Number.isFinite(price)||price<=0)throw Error('Invalid price.');return price;}
async function json(url:string,signal:AbortSignal,timeout=6000){const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('Price source unavailable.');return boundedJson(response,32000);}
/** Independent public USD sources; never assume a USDT/USDC peg or price unknown symbols. */
export async function readUsdReference(symbol:string,signal:AbortSignal):Promise<number>{
  const product=products[symbol];if(!product)throw Error('No trusted native reference configured.');
  try{return positive((await json(`https://api.exchange.coinbase.com/products/${product}/ticker`,signal,4000)).price);}catch{if(signal.aborted)throw Error('Price request cancelled.');}
  const sources=[async()=>{const data=await json(`https://api.coinbase.com/v2/prices/${product}/spot`,signal);if(data.data?.base!==symbol||data.data?.currency!=='USD')throw Error('Price pair mismatch.');return positive(data.data.amount);},async()=>{const pairs=kraken[symbol],data=await json(`https://api.kraken.com/0/public/Ticker?pair=${pairs[0]}`,signal);if(!Array.isArray(data.error)||data.error.length)throw Error('Price pair unavailable.');const keys=Object.keys(data.result||{});if(keys.length!==1||!pairs.includes(keys[0]))throw Error('Price pair mismatch.');return positive(data.result[keys[0]]?.c?.[0]);}];
  try{return await Promise.any(sources.map(read=>read()));}catch{throw Error('USD prices are temporarily unavailable. Asset amounts are unaffected.');}
}

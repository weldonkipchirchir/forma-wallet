import {bridgeRequest,BRIDGE_NETWORKS} from '../server/bridge-policy.mjs';
const LIMIT=1_000_000;
async function boundedJson(response){if(!response.ok)throw Error('Provider unavailable.');const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>LIMIT)throw Error('Response limit.');if(!response.body)throw Error('Empty response.');const reader=response.body.getReader();let length=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT)throw Error('Response limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export function createBridgeHandler({key=()=>process.env.RELAY_API_KEY,fetcher=globalThis.fetch,clock=Date.now}={}){
  const clients=new Map();let chainsCache;
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
    const url=new URL(req.url||'/api/bridge','https://wallet.invalid'),action=url.searchParams.get('action')||'quote',apiKey=key();
    if(action==='config'&&req.method==='GET'){send(200,{configured:typeof apiKey==='string'&&!!apiKey.trim(),source:'Relay',mode:'native-evm'});return;}
    if(!apiKey){send(503,{error:'Bridge not configured. Add RELAY_API_KEY to the server environment in Vercel.'});return;}
    if(!['quote','chains','status'].includes(action)){send(400,{error:'Unsupported bridge action.'});return;}
    const ip=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-forwarded-for']||'unknown').slice(0,100),now=clock();
    if(clients.size>5000)clients.clear();const old=clients.get(ip);if(old&&now-old.time<60000&&old.count>=15){send(429,{error:'Quote limit reached. Try again in a minute.'});return;}clients.set(ip,old&&now-old.time<60000?{time:old.time,count:old.count+1}:{time:now,count:1});
    try{
      let endpoint,options={method:'GET'};
      if(action==='quote'){
        if(req.method!=='POST'){send(405,{error:'Use POST for quotes.'});return;}
        if(!String(req.headers?.['content-type']||'').startsWith('application/json')){send(415,{error:'JSON body required.'});return;}
        const origin=new URL(req.headers?.origin||'https://invalid.invalid');if(origin.host!==req.headers?.host){send(403,{error:'Same-origin quote requests only.'});return;}
        if(Number(req.headers?.['content-length']||0)>4096){send(413,{error:'Request too large.'});return;}
        const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw||raw.length>4096)throw Error('Invalid body.');const request=bridgeRequest(JSON.parse(raw));
        endpoint='https://api.relay.link/quote/v2';options={method:'POST',body:JSON.stringify({user:request.user,recipient:request.recipient,originChainId:request.from.chainId,destinationChainId:request.to.chainId,originCurrency:request.from.native,destinationCurrency:request.to.native,amount:request.amount,tradeType:'EXACT_INPUT',slippageTolerance:'50',includeProtocolData:true,explicitDeposit:true,useDepositAddress:false,refundTo:request.user})};
      }else if(action==='chains'){
        if(req.method!=='GET'){send(405,{error:'GET required.'});return;}if(chainsCache&&now-chainsCache.time<300000){send(200,chainsCache.value);return;}endpoint='https://api.relay.link/chains';
      }else{
        if(req.method!=='GET'){send(405,{error:'GET required.'});return;}const id=url.searchParams.get('requestId');if(!/^0x[0-9a-f]{64}$/i.test(id||''))throw Error('Invalid request ID.');endpoint=`https://api.relay.link/intents/status/v3?requestId=${encodeURIComponent(id)}`;
      }
      const data=await boundedJson(await fetcher(endpoint,{...options,headers:{'Content-Type':'application/json','x-api-key':apiKey},signal:AbortSignal.timeout(12000),redirect:'error',credentials:'omit'}));
      let result=action==='quote'?{steps:data.steps,protocol:data.protocol,details:data.details,fees:data.fees}:action==='chains'?{chains:Array.isArray(data.chains)?data.chains.filter(chain=>BRIDGE_NETWORKS.some(network=>network.chainId===chain.id)).map(chain=>({id:chain.id,disabled:chain.disabled,depositEnabled:chain.depositEnabled,vmType:chain.vmType,protocol:chain.protocol})):[]}:data;
      if(JSON.stringify(result).includes(apiKey))throw Error('Unexpected provider response.');if(action==='chains')chainsCache={time:now,value:result};send(200,result);
    }catch{send(400,{error:'Bridge request could not be validated or the provider is unavailable. No transaction was sent.'});}
  };
}
export default createBridgeHandler();

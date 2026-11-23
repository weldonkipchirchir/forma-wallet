import {describe,it,expect,vi} from 'vitest';
// @ts-expect-error Node entry point is exercised through injected synthetic dependencies.
import {createBridgeHandler} from '../api/bridge.mjs';
const syntheticKey='synthetic-relay-test-key';
const body={from:'ethereum-mainnet',to:'base-mainnet',amount:'100',user:'0x0000000000000000000000000000000000000001',recipient:'0x0000000000000000000000000000000000000001'};
const request=(extra:any={})=>({method:'POST',url:'/api/bridge?action=quote',headers:{host:'isolated.invalid',origin:'https://isolated.invalid','content-type':'application/json'},body,...extra});
async function call(handler:any,req:any){let output='';const res:any={headers:{},setHeader(key:string,value:string){this.headers[key]=value;},end(value:string){output=value;}};await handler(req,res);return{status:res.statusCode,body:JSON.parse(output),headers:res.headers};}
describe('server-only bridge proxy',()=>{
  it('stays disabled without a key and never calls a provider',async()=>{const fetcher=vi.fn();const handler=createBridgeHandler({key:()=>undefined,fetcher});expect((await call(handler,request())).status).toBe(503);const config=await call(handler,request({method:'GET',url:'/api/bridge?action=config'}));expect(config.body.configured).toBe(false);expect(fetcher).not.toHaveBeenCalled();});
  it('sends only a normalized allowlisted request and keeps the synthetic key server-side',async()=>{
    const fetcher=vi.fn(async()=>Response.json({steps:[],protocol:{},unexpected:'discarded'})),handler=createBridgeHandler({key:()=>syntheticKey,fetcher});const result=await call(handler,request());expect(result.status).toBe(200);expect(result.body.unexpected).toBeUndefined();expect(JSON.stringify(result)).not.toContain(syntheticKey);expect(fetcher).toHaveBeenCalledOnce();const [url,options]=fetcher.mock.calls[0] as any;expect(url).toBe('https://api.relay.link/quote/v2');expect(options.headers['x-api-key']).toBe(syntheticKey);expect(options.redirect).toBe('error');expect(JSON.parse(options.body)).toMatchObject({originChainId:1,destinationChainId:8453,originCurrency:body.user.replace(/1$/,'0'),amount:'100',includeProtocolData:true,useDepositAddress:false});expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it.each([{method:'GET'},{headers:{host:'isolated.invalid',origin:'https://attacker.invalid','content-type':'application/json'}},{body:{...body,url:'http://169.254.169.254'}},{body:{...body,to:'tron-mainnet'}},{headers:{host:'isolated.invalid',origin:'https://isolated.invalid','content-type':'text/plain'}},{body:'x'.repeat(4097)}])('blocks invalid methods, origins, payloads and SSRF parameters',async invalid=>{const fetcher=vi.fn();const result=await call(createBridgeHandler({key:()=>syntheticKey,fetcher}),request(invalid));expect(result.status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();});
  it('redacts upstream errors and rejects key reflection or oversized data',async()=>{
    for(const fetcher of [vi.fn(async()=>{throw Error(syntheticKey);}),vi.fn(async()=>Response.json({protocol:{leak:syntheticKey}})),vi.fn(async()=>new Response('x'.repeat(1000001)))]){const result=await call(createBridgeHandler({key:()=>syntheticKey,fetcher}),request());expect(result.status).toBe(400);expect(JSON.stringify(result)).not.toContain(syntheticKey);}
  });
  it('bounds per-instance requests and caches only allowlisted chain metadata',async()=>{
    const fetcher=vi.fn(async()=>Response.json({chains:[{id:1,vmType:'evm',protocol:{}},{id:999999,vmType:'evm'}]})),handler=createBridgeHandler({key:()=>syntheticKey,fetcher,clock:()=>1000});const req=request({method:'GET',url:'/api/bridge?action=chains'});expect((await call(handler,req)).body.chains).toHaveLength(1);await call(handler,req);expect(fetcher).toHaveBeenCalledOnce();for(let i=2;i<15;i++)await call(handler,req);expect((await call(handler,req)).status).toBe(429);
  });
});

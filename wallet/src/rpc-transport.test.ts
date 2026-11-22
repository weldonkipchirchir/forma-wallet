import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedRpcRequest, createRpcProvider, RPC_RESPONSE_LIMIT, RPC_TIMEOUT_MS } from './rpc-transport';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('bounded EVM transport', () => {
  it('pins the endpoint and omits credentials, redirects and caching', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"result":"0x1"}', {status:200})); vi.stubGlobal('fetch',fetch);
    const req = boundedRpcRequest('https://rpc.example/'); req.method='POST'; req.body='{"method":"eth_chainId"}';
    const response = await req.getUrlFunc(req);
    expect(response.body?.length).toBeGreaterThan(0);
    expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
    req.url='https://other.example/'; await expect(req.getUrlFunc(req)).rejects.toThrow('endpoint'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects credential-bearing endpoints and requests before fetching', async()=>{
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    for(const url of ['https://user:pass@rpc.example/','https://rpc.example/?key=secret','data:application/json,{}','https://rpc.example/#secret']) expect(()=>boundedRpcRequest(url)).toThrow();
    const req=boundedRpcRequest('https://rpc.example/'); req.setHeader('Authorization','Bearer synthetic');
    await expect(req.getUrlFunc(req)).rejects.toThrow('credentials'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects oversized declared and streamed responses before decoding JSON',async()=>{
    let cancelled=false;
    const stream=()=>new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(RPC_RESPONSE_LIMIT));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(stream())));
    const req=boundedRpcRequest('https://rpc.example/'); await expect(req.getUrlFunc(req)).rejects.toThrow('size'); expect(cancelled).toBe(true);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{headers:{'content-length':String(RPC_RESPONSE_LIMIT+1)}})));
    await expect(req.getUrlFunc(req)).rejects.toThrow('size');
  });
  it('aborts stalled transport and does not retry a submitted request',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn((_url, options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
    vi.stubGlobal('fetch',fetch); const req=boundedRpcRequest('https://rpc.example/');
    const result=req.getUrlFunc(req); const checked=expect(result).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS); await checked; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('stops throttled request retries and retains valid ethers provider decoding',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:429})); vi.stubGlobal('fetch',fetch);
    const req=boundedRpcRequest('https://rpc.example/'); req.method='POST'; req.body={method:'eth_sendRawTransaction',params:['0x00']};
    // Ethers converts an exhausted throttle attempt into its synthetic 599 error response.
    expect((await req.send()).statusCode).toBeGreaterThanOrEqual(400); expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{const data=JSON.parse(new TextDecoder().decode(options.body)); const reply=(row:{id:number})=>({jsonrpc:'2.0',id:row.id,result:'0xaa36a7'}); return new Response(JSON.stringify(Array.isArray(data)?data.map(reply):reply(data)));}));
    const provider=createRpcProvider('https://rpc.example/');
    try { expect((await provider.getNetwork()).chainId).toBe(11155111n); } finally {provider.destroy();}
  });
});

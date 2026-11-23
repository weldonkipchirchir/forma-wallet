import { FetchRequest, JsonRpcProvider, type FetchGetUrlFunc } from 'ethers';
import { boundedText } from './bounded-response';

export const RPC_RESPONSE_LIMIT = 2_000_000;
export const RPC_TIMEOUT_MS = 15_000;

/** An endpoint may see public addresses/signed transactions, never browser credentials. */
export function boundedRpcRequest(endpoint: string): FetchRequest {
  const url = new URL(endpoint);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(import.meta.env.DEV && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash) throw new Error('Unsupported RPC endpoint.');
  const pinned = url.href;
  const request = new FetchRequest(pinned);
  request.timeout = RPC_TIMEOUT_MS;
  request.setThrottleParams({ maxAttempts: 1 });
  const transport: FetchGetUrlFunc = async (req, cancel) => {
    if (new URL(req.url).href !== pinned || req.credentials || Object.keys(req.headers).some(key => ['authorization', 'cookie'].includes(key.toLowerCase()))) throw new Error('RPC endpoint or credentials changed.');
    cancel?.checkSignal();
    const controller = new AbortController();
    cancel?.addListener(() => controller.abort());
    const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    try {
      const response = await fetch(pinned, {
        method: req.method, headers: req.headers, body: req.body === null ? undefined : new Uint8Array(req.body),
        signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
      });
      // Bound streamed (including decompressed) bytes before ethers JSON decoding.
      const text = await boundedText(response, RPC_RESPONSE_LIMIT);
      cancel?.checkSignal();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      return { statusCode: response.status, statusMessage: response.statusText, headers, body: new TextEncoder().encode(text) };
    } finally { clearTimeout(timeout); }
  };
  request.getUrlFunc = transport;
  return request;
}

export function createRpcProvider(endpoint: string, freshReads=false) { return new JsonRpcProvider(boundedRpcRequest(endpoint),undefined,freshReads?{cacheTimeout:-1}:undefined); }

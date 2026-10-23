export const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export function validatePublicEnvironment(env, production = false) {
  // Hosting metadata is not wallet configuration. Vite separately restricts
  // browser exposure to the validated RPC variable in vite.config.ts.
  for (const key of Object.keys(env)) if (key.startsWith('VITE_') && key !== 'VITE_SEPOLIA_RPC_URL' && !key.startsWith('VITE_VERCEL_')) throw new Error(`Unsupported public build variable: ${key}`);
  let rpc;
  try { rpc = new URL(env.VITE_SEPOLIA_RPC_URL || DEFAULT_RPC); } catch { throw new Error('Invalid public RPC URL.'); }
  if (rpc.username || rpc.password || rpc.search || rpc.hash) throw new Error('RPC URL must not contain credentials, query parameters or fragments.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname);
  if (rpc.protocol !== 'https:' && !(rpc.protocol === 'http:' && local && !production)) throw new Error('RPC must use HTTPS; local HTTP is allowed only in development.');
  if (production && (local || rpc.pathname !== '/')) throw new Error('Production requires a public root RPC endpoint without an embedded path key.');
  return rpc;
}
export function securityHeaders(rpc, production = false) {
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${production ? '' : 'ws://127.0.0.1:* ws://localhost:* '}${rpc.origin} https://eth-sepolia.blockscout.com https://data-api.binance.vision https://api.exchange.coinbase.com https://manager.api.live.ledger.com https://global.api.prd.ledger.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), hid=(self)',
    ...(production ? { 'Strict-Transport-Security': 'max-age=86400' } : {}),
  };
}

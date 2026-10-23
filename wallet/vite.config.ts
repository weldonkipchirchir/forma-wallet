import { defineConfig, loadEnv } from 'vite';
import { securityHeaders, validatePublicEnvironment } from './security-policy.mjs';
export default defineConfig(({ mode }) => {
  const rpc = validatePublicEnvironment(loadEnv(mode, process.cwd(), 'VITE_'), mode === 'production');
  return { envPrefix: 'VITE_SEPOLIA_RPC_URL', build: { sourcemap: false }, server: { headers: securityHeaders(rpc, false) }, preview: { headers: securityHeaders(rpc, true) } };
});

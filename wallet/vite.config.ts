import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { securityHeaders, validatePublicEnvironment } from './security-policy.mjs';
export default defineConfig(({ mode }) => {
  const rpc = validatePublicEnvironment(loadEnv(mode, process.cwd(), 'VITE_'), mode === 'production');
  return { envPrefix: 'VITE_SEPOLIA_RPC_URL', test: { maxWorkers: 2, testTimeout: 30000 }, build: { sourcemap: false }, server: { headers: securityHeaders(rpc, false) }, preview: { headers: securityHeaders(rpc, true) } };
});

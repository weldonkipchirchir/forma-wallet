import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_RPC, securityHeaders } from '../security-policy.mjs';
export function vercelConfig() {
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    installCommand: 'npm ci --ignore-scripts',
    buildCommand: 'npm test && npm run build && npm audit --audit-level=moderate',
    outputDirectory: 'dist',
    headers: [
      { source: '/(.*)', headers: Object.entries(securityHeaders(new URL(DEFAULT_RPC), true)).map(([key, value]) => ({ key, value })) },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ],
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('../vercel.json', import.meta.url), JSON.stringify(vercelConfig(), null, 2) + '\n');
  console.log('Vercel static hosting configuration generated. No deployment was made.');
}

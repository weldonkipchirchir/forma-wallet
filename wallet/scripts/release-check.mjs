import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { securityHeaders, validatePublicEnvironment } from '../security-policy.mjs';
export function sensitiveMarkers(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
    || /\bAKIA[A-Z0-9]{16}\b/.test(text) || /\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text)
    || /\b(?:private[_-]?key|seed[_-]?phrase|mnemonic)["']?\s*[:=]\s*["'](?:0x[\da-f]{64}|[a-z]+(?: [a-z]+){11,23})["']/i.test(text);
}
export async function prepareRelease(root) {
  const rpc = validatePublicEnvironment(loadEnv('production', root, 'VITE_'), true);
  let vercel;
  try { vercel = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid Vercel configuration.'); }
  if (vercel) {
    const configured = Object.fromEntries((vercel.headers?.find(row => row.source === '/(.*)')?.headers || []).map(row => [row.key, row.value]));
    for (const [key, value] of Object.entries(securityHeaders(rpc, true))) if (configured[key] !== value) throw new Error(`Vercel header policy mismatch: ${key}. Review vercel.json before deploying.`);
  }
  const dist = resolve(root, 'dist'), entries = [];
  async function walk(directory) {
    for (const name of await readdir(directory)) {
      const path = resolve(directory, name), info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Release must not contain symbolic links.');
      if (info.isDirectory()) { await walk(path); continue; }
      const file = relative(dist, path).replaceAll('\\', '/');
      if (!['.html', '.js', '.css', '.svg', '.png', '.ico', '.woff2'].includes(extname(name)) || name.startsWith('.')) throw new Error(`Unexpected release file: ${file}`);
      const bytes = await readFile(path);
      if (sensitiveMarkers(bytes.toString('utf8'))) throw new Error(`Potential secret marker in built file: ${file}. Inspect privately; do not print its contents.`);
      entries.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
  await walk(dist);
  if (!entries.some(e => e.file === 'index.html') || !entries.some(e => e.file.endsWith('.js'))) throw new Error('Build output is incomplete.');
  const generated = resolve(root, '.release'); await mkdir(generated, { recursive: true });
  const headers = securityHeaders(rpc, true);
  await writeFile(resolve(generated, 'security.headers'), 'header {\n' + Object.entries(headers).map(([k, v]) => `  ${k} "${v}"`).join('\n') + '\n  -Server\n}\n');
  await writeFile(resolve(generated, 'manifest.json'), JSON.stringify({ chainId: 11155111, rpcOrigin: rpc.origin, headers, files: entries.sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
  return entries.length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Release checks passed for ${await prepareRelease(fileURLToPath(new URL('..', import.meta.url)))} files; headers and SHA-256 manifest generated in .release/.`); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Release check failed.'); process.exitCode = 1; }
}

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { validatePublicEnvironment, securityHeaders, DEFAULT_RPC } from '../security-policy.mjs';
import { prepareRelease, sensitiveMarkers } from '../scripts/release-check.mjs';
import { vercelConfig } from '../scripts/vercel-config.mjs';
import { resolveConfig } from 'vite';

describe('production build boundaries', () => {
  it('ignores Vercel metadata and excludes it from browser environment variables', async () => {
    const key = 'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG';
    const previous = process.env[key];
    process.env[key] = 'forma-platform-metadata-test';
    try {
      expect(validatePublicEnvironment({ [key]: process.env[key], VITE_VERCEL_GIT_REPO_ID: '123' }, true).href).toBe(DEFAULT_RPC + '/');
      const config = await resolveConfig({ mode: 'production' }, 'build');
      expect(config.env[key]).toBeUndefined();
      expect(config.envPrefix).toBe('VITE_SEPOLIA_RPC_URL');
      expect(() => validatePublicEnvironment({ [key]: 'metadata', VITE_SECRET: 'private' }, true)).toThrow('VITE_SECRET');
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  });
  it('configures Vercel with production headers and test-gated static builds', () => {
    const config = vercelConfig();
    expect(config.framework).toBe(null);
    expect(config.outputDirectory).toBe('dist');
    expect(config.buildCommand).toContain('npm test && npm run build');
    expect(Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]))).toEqual(securityHeaders(new URL(DEFAULT_RPC), true));
    expect(config.rewrites).toBeUndefined();
  });
  it('rejects exposed credentials, unsupported variables and unsafe production RPCs', () => {
    for (const url of ['https://user:password@example.com/', 'https://example.com/?key=secret', 'https://example.com/#secret', 'http://example.com/', 'https://localhost/', 'https://example.com/private-key']) {
      expect(() => validatePublicEnvironment({ VITE_SEPOLIA_RPC_URL: url }, true)).toThrow();
    }
    expect(() => validatePublicEnvironment({ VITE_SECRET: 'do not print me' }, true)).toThrow('VITE_SECRET');
    expect(validatePublicEnvironment({}, true).href).toBe(DEFAULT_RPC + '/');
    expect(validatePublicEnvironment({ VITE_SEPOLIA_RPC_URL: 'http://localhost:8545' }).hostname).toBe('localhost');
  });
  it('keeps production CSP free of development sockets and unsafe script execution', () => {
    const headers = securityHeaders(new URL(DEFAULT_RPC), true);
    expect(headers['Content-Security-Policy']).not.toContain('ws:');
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Strict-Transport-Security']).toBe('max-age=86400');
    expect(headers['Permissions-Policy']).toContain('hid=(self)');
  });
  it('detects common secret markers without classifying public hashes as secrets', () => {
    expect(sensitiveMarkers('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(sensitiveMarkers(JSON.stringify({ privateKey: '0x' + '1'.repeat(64) }))).toBe(true);
    expect(sensitiveMarkers('const privateKey = "0x' + '1'.repeat(64) + '"')).toBe(true);
    expect(sensitiveMarkers('0x' + '1'.repeat(64))).toBe(false);
  });
  it('generates headers/checksums and rejects source maps or secret-bearing assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forma-release-'));
    try {
      await mkdir(join(root, 'dist'));
      await writeFile(join(root, 'dist', 'index.html'), '<html></html>');
      await writeFile(join(root, 'dist', 'app.js'), 'console.log("public");');
      expect(await prepareRelease(root)).toBe(2);
      const manifest = JSON.parse(await readFile(join(root, '.release', 'manifest.json'), 'utf8'));
      expect(manifest.chainId).toBe(11155111);
      expect(manifest.files.every(file => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
      expect(await readFile(join(root, '.release', 'security.headers'), 'utf8')).toContain('Strict-Transport-Security');
      const mismatched = vercelConfig(); mismatched.headers[0].headers = [];
      await writeFile(join(root, 'vercel.json'), JSON.stringify(mismatched));
      await expect(prepareRelease(root)).rejects.toThrow('Vercel header policy mismatch');
      await writeFile(join(root, 'vercel.json'), JSON.stringify(vercelConfig()));
      await writeFile(join(root, 'dist', 'app.js'), '-----BEGIN PRIVATE KEY-----');
      await expect(prepareRelease(root)).rejects.toThrow('Potential secret marker');
      await writeFile(join(root, 'dist', 'app.js'), 'public');
      await writeFile(join(root, 'dist', 'app.js.map'), '{}');
      await expect(prepareRelease(root)).rejects.toThrow('Unexpected release file');
    } finally {
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'forma-release-')) throw new Error('Unexpected temporary path');
      await rm(root, { recursive: true, force: true });
    }
  });
});

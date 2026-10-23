# Sepolia production hosting preparation

Prepared configuration; **nothing has been deployed**. Local validation: unit/integration and release tests, production build, generated headers/manifest. Docker and Caddy were not installed on the development machine; container execution, certificate issuance and public HTTP responses remain unverified. GitHub Actions will run only after these files are committed/pushed to a repository with Actions enabled.

## Build and inspect

From `wallet/`, run `npm ci --ignore-scripts`, `npm test`, `npm run build`, and `npm audit --audit-level=moderate`. Use Node 24. The postbuild step rejects source maps, unexpected output types and common secret markers, then generates `.release/security.headers` and `.release/manifest.json` containing per-file SHA-256 hashes. Neither generated file is served as wallet content. These are heuristic checks, not proof that every possible secret or malicious dependency is absent. Review source/build provenance separately.

Every `VITE_` variable is public. Only `VITE_SEPOLIA_RPC_URL` is allowed. Production requires a public HTTPS root endpoint without userinfo, query/fragment or a path that could contain an API key. The Docker build deliberately uses the default public Sepolia RPC and accepts no credential build arguments. A private RPC proxy would be a separate reviewed backend. Never expose a paid/private provider key in browser configuration.

## Caddy container

`Dockerfile` builds from the lockfile, copying only explicit source/config paths, then copies only built static files and generated headers into Caddy. `.dockerignore` excludes other files, including local environment files. Node and Caddy images are pinned to Docker Hub manifest digests verified during preparation. Review and update digests/security advisories regularly; pinning alone does not keep an image patched.

The Caddyfile uses an operator-provided domain for automatic HTTPS, disallows private/source paths, serves hashed assets with immutable caching and HTML with `no-store`, and keeps missing files as 404s. There is no directory listing, service worker or SPA fallback. Production CSP excludes development WebSockets; scripts are same-origin only. Inline styles remain permitted for chart/runtime styling. Ledger SDK network origins remain explicit. HSTS starts at one day without subdomain or preload scope; expand it only after validating HTTPS operation.

After deployment approval, choose a dedicated wallet hostname, point DNS at a reviewed server, set `WALLET_DOMAIN` to that hostname, and use `docker compose -f deploy/compose.yaml up -d --build` from this folder. This command exposes ports 80/443 and requests certificates: it was **not executed** during preparation. Compose requests a read-only root filesystem, temporary /tmp, persistent writable Caddy data/config volumes, dropped capabilities except port binding, and no-new-privileges. The stock Caddy image user is unchanged; this is not a claim of a non-root deployment. Validate these restrictions in the container job and on the target host. Persist the Caddy data/config volumes. Protect DNS/hosting accounts and keep the wallet on its own origin without unrelated scripts/apps. A change of origin creates separate browser storage; existing encrypted wallets do not automatically migrate. Never ask users to move hardware recovery phrases.

Validate with `docker run --rm -e WALLET_DOMAIN=wallet.example.invalid IMAGE caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` before serving. The CI container job uses loopback HTTP solely to exercise headers, cache policy and 404 handling; it does not test public TLS. For an approved public default-RPC deployment, run `node scripts/check-host.mjs https://YOUR_WALLET_HOST` and separately verify HTTP-to-HTTPS redirection and certificate validity. The checker expects the default RPC policy; a reviewed custom RPC requires corresponding expected headers.

## CI and release gates

`.github/workflows/wallet-ci.yml` uses official commit-pinned actions, read-only repository permissions, no persisted checkout credentials, lockfile installs, tests/build/release scans, moderate-or-higher advisory failure, and container/header smoke checks. It has no deploy job or production secrets. CI cannot certify mainnet readiness. Dependency install lifecycle scripts are disabled; validate a clean build after dependency upgrades.

- [ ] Commit and review the exact source, lockfile, image digests, workflow and generated manifest.
- [ ] Run CI successfully, including clean Linux container build, Caddy config validation and loopback smoke checks.
- [ ] Verify public DNS/TLS/redirects, CSP/HSTS/HID headers, 404s and caching on the actual approved host.
- [ ] Configure and test the monitored private channel in `SECURITY-POLICY.md`; assign incident ownership.
- [ ] Complete `USER-FLOW-TESTING.md`, including disposable live transfers, browser recovery, mobile checks and physical Ledger testing.
- [ ] Obtain independent security review before considering real funds; keep chain ID 11155111 and testnet notices.
- [ ] Record deployed commit/image digest and rollback image. Rollback must preserve hostname and users' local vaults; never clear browser storage as a deployment fix.

References: [Caddy file serving](https://caddyserver.com/docs/caddyfile/directives/file_server), [Caddy headers](https://caddyserver.com/docs/caddyfile/directives/header), [checkout action](https://github.com/actions/checkout), [Node setup action](https://github.com/actions/setup-node).

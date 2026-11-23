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


## Optional Relay quote preview on Vercel

The root `wallet/api/bridge.mjs` is a Vercel Node function. Shared public policy lives in `wallet/server/`; the frontend never imports the function or its environment access. Existing static Docker/Caddy hosting does not run this API, so bridge previews stay unavailable there unless a separately reviewed backend is deployed.

1. Create a Relay application and obtain its API key privately.
2. Start with a protected Vercel Preview deployment. In the Forma project, open **Environment Variables**, add `RELAY_API_KEY` for Preview only, and redeploy. Never use a `VITE_` name, paste the key into chat, or commit a local credentials file.
3. Open Swap → Across networks. Missing-key deployments remain disabled. Key configuration enables quote requests only; this release never signs a bridge deposit.
4. Validate representative real provider response formats and version/solver/chain metadata against the prepared checks before planning signing support. This development run used synthetic responses only.
5. Before exposing a paid provider key through a public production proxy, add durable shared rate limits, usage budgets/alerts, bot/abuse controls and an operational owner. The included 15-requests/minute in-memory IP limit is best effort per function instance, **not** a production-wide quota. A client-controlled Origin header is not authentication.

Requests are allowlisted to fixed Relay endpoints, with bounded bodies/responses, redirects disabled, generic errors and no-store responses. The API key is sent only in the server-to-Relay header. The static CSP does not add Relay to browser connect-src. Provider responses are still untrusted; quote checks do not certify settlement safety or price fairness. A future release must add independent protocol-chain pins, live bytecode validation, simulation, explicit signing review, durable source submission tracking and destination/refund reconciliation before enabling a bridge send.

[Vercel Node functions](https://vercel.com/docs/functions/runtimes/node-js) support `.mjs` entry points under the project root's `api/` directory. Vite's local server alone does not execute Vercel functions; use an isolated mocked config response for UI tests or an appropriately configured local server adapter.

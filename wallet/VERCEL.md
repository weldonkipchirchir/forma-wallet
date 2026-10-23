# GitHub and Vercel setup

This setup expects the GitHub repository root to contain `wallet/` and `.github/workflows/wallet-ci.yml`, matching D:/event-flow-app. If you publish only the contents of wallet/ as a separate repository, first adapt the workflow paths, working directory and Docker build context; do not copy the current monorepo workflow unchanged.

## Push and see test/build status

Commit the reviewed wallet source, package-lock.json, vercel.json, scripts/tests and root .github/workflows/wallet-ci.yml, then push to GitHub. Do not commit local environment files, node_modules, dist, .release, encrypted backups or recovery material. The workflow runs on pushes/pull requests affecting wallet or the workflow file, and also supports manual workflow_dispatch.

Open GitHub > Actions > Wallet checks. The Tests, build and security job shows separate install, test, production build/release scan and dependency-advisory steps. Caddy container and hosting checks is a second job for the alternative Docker host. Each shows a green check or failure with logs. Hosted execution has not yet been verified. Configure branch protection on the production branch to require the relevant successful checks before merging.

## Import into Vercel

1. Import the GitHub repository as a Vercel project.
2. Set Root Directory to wallet. Use Other for Framework Preset; vercel.json intentionally uses framework:null to provide a plain static build without automatic framework rewrites/environment additions.
3. Use Node.js 24.x. package.json also specifies 24.x.
4. Leave install/build/output settings to wallet/vercel.json: npm ci --ignore-scripts; npm test && npm run build && npm audit --audit-level=moderate; output dist.
5. No environment variables are needed for the default public Sepolia RPC. Do not add private provider credentials. Disable automatic framework-prefixed VITE_VERCEL_* additions if an imported project has them enabled; unknown VITE_ variables deliberately fail the public-environment guard.
6. Deploy after reviewing the project and production branch. No Vercel deployment has been performed by the assistant.

Vercel builds run the tests/audit themselves; they do not automatically wait for the separate GitHub Caddy job. Use protected branches for merge gating. The static Vercel deployment does not use Docker or Caddy. The vercel.json file supplies the production CSP, anti-framing, referrer, permissions/HID and HSTS headers, plus no-store for HTML and immutable caching for hashed assets. There is no catch-all rewrite to HTML for missing files.

After deployment, check the actual response headers and root/assets/404 behavior, then run the disposable-wallet and Ledger flows. The hosting checker in scripts/check-host.mjs can help, but protected previews or platform-specific cache/header behavior must be reviewed separately; local tests do not prove deployed headers. The root wallet remains Sepolia-only and unaudited for real funds.

Localhost, Vercel previews and a production domain each have separate browser storage. A saved localhost wallet will not appear automatically on a Vercel URL. For test-wallet recovery, use its encrypted backup and backup password through the import flow, with a new local password. Ledger wallets require reconnecting the device, never importing its seed. Choose a stable production hostname and avoid using changing preview URLs as the permanent home of a wallet.

## Keeping configuration in sync

npm run config:vercel regenerates vercel.json from security-policy.mjs using the default public RPC. Review and commit changes. The release check fails if the configured Vercel security headers do not match the production environment; a custom RPC needs a reviewed config/generator update. Never resolve that failure by weakening the CSP or bypassing the release check.

Validation: 94 tests pass, production build and release checks pass, npm dependency audit is clear. GitHub-hosted Actions, Vercel deployment, actual platform headers and Docker runtime remain pending.

References: https://vercel.com/docs/project-configuration/vercel-json and https://vercel.com/docs/builds/configure-a-build.

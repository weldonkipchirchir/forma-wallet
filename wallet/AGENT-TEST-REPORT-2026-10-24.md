# Agent test review — 24 October 2026

Three agents reviewed security, multichain features and UI. The primary agent ran the full regression suite, production build and dependency advisory check, and applied fixes. This is an internal engineering review, not an independent audit.

## Fixed findings

- Solana signer cleanup: the SDK's `secretKey` getter returns a copy, so zeroing that copy did not revoke the retained signer. Lock now marks the session disposed, clears the application-held signer reference and rejects subsequent Bitcoin, SOL and SPL signing through that session. Async Solana paths check revocation before signing and before returning serialized transactions. SDK/private browser memory destruction remains outside the supported API.
- SPL activity search: network mint identifiers live inside transaction movements. Search now includes those mints, trims whitespace and combines status filters correctly.
- Password errors: light-mode paragraph styling overrode the intended red text. Browser computed-color checks confirmed the corrected light and dark colors. Password-change, backup-verification, phrase-reveal and phrase-restore errors now use inline form alerts too. Error scrolling respects reduced-motion preferences.

## Verification

- Full suite: 147 tests passed across 26 files, including new mint-search and disposed-session regressions.
- Production TypeScript/Vite build and release checks passed for seven artifacts. The build still reports large-chunk and third-party annotation warnings.
- Dependency audit: zero published advisories reported. This does not establish that dependencies are safe.
- Browser: isolated localhost wallet, deliberately wrong synthetic password; inline placement/focus, both theme colors, Restore/Saved tabs, keyboard End navigation and password clearing when changing tabs checked.
- No user recovery phrase/password inspected and no funded transactions sent.

## Open findings and verification limits

1. **Solana unresolved-submission recovery:** a rejected, expired or dropped transaction can remain unknown and block future sends indefinitely. The journal does not preserve its last-valid block height. Do not clear records or auto-retry to work around this. A recovery change needs expiry metadata, finalized-height checks and historical status/transaction lookup; keep unknown when verification fails. Legacy records require separate handling.
2. **Network counterparty search:** network history currently retains transaction IDs and movement mints, not counterpart addresses. Address search only matches local submission recipients. The current search hint overstates coverage.
3. Funded ETH/BTC/SOL/ERC-20/SPL end-to-end tests, real Ledger hardware, mobile viewport testing and actual screen-reader announcement testing remain unverified.
4. Browser scripts/extensions, compromised deployments and dependency publishers remain trust boundaries. Revoking the application session does not guarantee erasure of JavaScript strings, SDK memory or browser snapshots.

Keep the wallet testnet-only. These local changes still need commit, deployment and deployed-site verification.

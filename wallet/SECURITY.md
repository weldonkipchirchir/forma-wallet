# Security review — 22 October 2026

Scope: local Forma browser wallet source, imports/recovery, transfer review, history rendering, network configuration, dependency audit and appearance. This is an engineering review, not an independent audit or penetration test.

## Bitcoin and Solana extension — 23 October 2026

The shared-primary-wallet Bitcoin Testnet3 / Solana Devnet accounts, preserved older separate vault and native transfer implementation is documented in [MULTICHAIN.md](MULTICHAIN.md). It uses pinned transaction/crypto dependencies, bounded encrypted imports, deterministic network-specific paths, genesis identity checks, review-bound signing, BTC previous-output validation, Solana simulation, cross-tab operation locks and durable pre-broadcast unknown-submission records. Public addresses and signed transactions are disclosed to the selected testnet service. Mainnet, arbitrary instructions, SPL assets, automatic account discovery and Ledger signing for these networks are unsupported. Primary encrypted backups and password changes are tested for preserving all three network addresses, including older wrapped-backup import. Raw Ethereum-key and BIP-39-passphrase imports are excluded from shared derivation. Independent audit, funded end-to-end transfers, physical-phone testing and two-browser restore remain outstanding; automated/offline and local UI checks do not establish real-fund readiness.

## Changes made

- Validate cached transaction records before rendering; allow only known statuses, IDs, hashes, addresses, amounts and timestamps. Escape the status CSS attribute as well as text.
- Bound imported keystore key-derivation parameters before decryption to prevent extreme memory/CPU requests from an imported file. Unsupported formats are rejected without modifying the existing vault.
- Invalidate a pending fee review if the recipient or amount changes while estimation is in progress.
- Populate and sign locally, then recheck the lock/view generation before broadcast. Locking before that check cancels broadcast. A transfer already handed to the network cannot be recalled.
- Drop active wallet references on page hiding, page exit and active-vault changes in another tab. Clear entered unlock/import passwords before asynchronous work where possible. JavaScript cannot guarantee zeroing secret memory.
- Add restrictive CSP, anti-framing, nosniff, referrer and browser permission headers to Vite dev/preview. Restrict RPC configuration to HTTPS except local development HTTP. Static production hosting must reproduce these headers; Vite config does not configure a third-party host.
- Add System/Light/Dark selection with local preference persistence and system appearance change handling. QR backgrounds remain white for scanning.

## Remaining limits

- ERC-20 support is limited to Sepolia. Token metadata is unverified, escaped before display and bounded; cached token metadata is validated. Transfers use exact integer units, reject zero addresses, simulate transfer, check token and gas balances, require review and confirmation, and check active-wallet state before broadcast. Only transfer is encoded; no allowance approvals are created. Malicious, rebasing or fee-on-transfer tokens can still behave unexpectedly. Automated unit tests and read-only browser checks do not replace a live token-transfer test or independent review.

- Do not use real funds or import a real-funded wallet. Browser extensions, malicious same-origin code, compromised dependencies and a compromised device can read unlocked keys or recovery words. CSP reduces attack surface but does not remove this trust boundary.
- An attacker who copies localStorage can attempt offline password guessing against the encrypted keystore. Strong unique passwords and secure offline backups matter. There is no hardware-backed signing or password recovery.
- No independent audit, browser end-to-end security suite or adversarial RPC testing has been completed. Automated tests cover validation, keystore recovery and selected security boundaries; visual checks are not a WCAG certification.
- Activity is indexer data, may lag, and is not proof of settlement. Public RPC and Blockscout learn queried addresses. Balance hiding is a visual privacy feature; public-chain data remains public.
- Imported keystores lacking mnemonic metadata (including BIP-39 passphrase imports encrypted by ethers) recover via encrypted JSON but cannot reveal their original phrase.
- Production needs HTTPS, reviewed hosting headers, reproducible dependency-controlled builds, recovery backup verification, threat modelling and independent assessment before mainnet is considered.

## Follow-up review and wallet pattern research

Reviewed 22 October 2026. Reference patterns: MetaMask's recipient/address-poisoning checks (https://metamask.io/en-GB/news/address-poisoning-detection), MetaMask simulation limitations (https://support.metamask.io/manage-crypto/transactions/simulations/), and Phantom reversible hidden assets (https://help.phantom.com/articles/manage-hidden-tokens-and-collectibles-in-phantom-42969287602963). Only these primary sources were used for the implemented patterns; similarly named unofficial wallet sites were not used.

Fixed findings:

- Session lifecycle: hiding/exiting the page or changing the active vault in another tab now invalidates pending unlock/import operations as well as active sessions. Previously a decryption begun while locked could finish after the page became hidden.
- Local keystore decryption now checks work-factor bounds as well as imported files, limiting resource-exhaustion from modified browser storage.
- Native/token reviews expire after two minutes and require explicit full-address/network acknowledgement. Lookalike recipients with the same first four and last four hex characters as a different recipient in loaded outgoing history are blocked. Self-transfers warn about gas. These are local heuristics, not a threat intelligence service; incomplete history and other lookalike patterns can evade detection.
- Token send re-reads decimals before computing the transfer. Long amounts and Unicode bidirectional/control characters in token names are rejected.
- Reversible token hiding removes assets from Portfolio and send selection without deleting keys or moving tokens; hidden assets can be restored from Tokens. This is manual visibility management, not an automatic spam classifier.

Validation: expanded unit suite covers 24 tests. Dependency audit reported no known advisories at review time. Production build succeeds with a bundle-size warning (performance follow-up, not a security finding). Read-only browser checks do not establish mainnet readiness, and no external token transfer was broadcast. Hardware-backed signing, an independent audit and actual disposable-token end-to-end transfer/receipt checks are still outstanding.

Runtime verification found the pre-existing dev server was serving none of the configured security headers. Restarted only the verified wallet Vite process on port 5175 with explicit config, and verified actual HTTP responses now include CSP (with frame-ancestors none), nosniff, no-referrer and restrictive Permissions-Policy. Dev/preview scripts now explicitly select the Vite config. Reloaded wallet successfully with those headers active. A separate production host still needs matching server headers.

Browser follow-up confirmed: unlock works with work-factor validation; test USDC can be hidden and restored; native ETH review displays full address, self-transfer fee warning, Sepolia network, two-minute expiry notice and required acknowledgement. The prepared review was cancelled. No funds were broadcast and recovery words were not revealed. The wallet was left locked after the header-verification reload.

## Deeper research and adversarial review

See [SECURITY-RESEARCH-2026-10-22.md](SECURITY-RESEARCH-2026-10-22.md) for the later 44-test validation, primary-source wallet comparisons, backup re-encryption and signed-intent checks, live browser evidence, and remaining architecture/release work. The earlier 24-test result above is historical.


## Recovery and token tracking implementation - 23 October 2026

Added address-matching backup verification, current-password-gated local password changes with generation/vault identity checks, saved-wallet update and rollback on active-write failure, and durable token-submission records persisted before broadcast. Receipt reconciliation uses RPC responses; Unknown is not Failed, and no automatic retry occurs. Refresh history to update recorded statuses. Recovery tests use disposable keys; browser verification did not change the user's password or broadcast funds. 50 tests pass across 10 files. Earlier reports describe the state before these features were implemented. See README for operation and remaining limits.

Storage updates are compensating writes, not a cross-tab database transaction. Browser storage corruption/deletion, device compromise and concurrent writers remain limitations. Previously downloaded backups are not revoked by local password changes. The new receipt journal does not implement confirmation-depth finality, nonce replacement detection or cancellation.


## Watch-only implementation - 23 October 2026

Watch-only tracking is available with the signing wallet locked. Its module receives a read-only API (network, ETH balance, token balance/metadata and indexed activity); no wallet, signer, signing callback or vault access is provided. When viewing watched accounts, signing/import/recovery forms are not rendered. With an unlocked wallet, the signing account remains separate and navigation back returns to it; watch-only is not a security boundary against malicious application code or a compromised device.

Public account lists and watch-specific token metadata persist separately from encrypted vaults and signing-wallet token lists. No ownership claim or independent identity verification is implied. Guarded request revisions/disposal prevent previous selections and abandoned views from replacing the current result. Wrong-chain reads are rejected, provider failures are labelled, and recent direct/internal ETH history is explicitly partial. No automatic token discovery, token transfer history, finality guarantee or fiat accounting is provided by this view.

Validation: 60 tests across 12 files pass; production build succeeds with the existing bundle-size warning. Browser checks confirmed watched account persistence, 0.05 Sepolia ETH, the faucet receipt, zero watched USDC balance and return to the locked signing-wallet screen, all without unlocking or broadcasting. A public watch entry named Sepolia test wallet and its separately tracked test-USDC metadata were retained for the user. See README for usage, data disclosure and storage limits.


## Transaction reliability - 23 October 2026

Added shared persist-before-broadcast handling for native ETH and token sends, nonce metadata, receipt confirmation counts, conservative missing-hash/nonce-use observations and guarded journal refreshes. Automated tests cover simulated timeouts, storage failures, lock/review invalidation before handoff and locking after handoff. No automatic retry is performed. Outcome hints depend on the configured Sepolia RPC; consumed nonce does not prove replacement and an absent hash does not prove dropping. A disappearing receipt removes previously verified confirmation counts. Confirmation count is not independent finality. See README for operation and limits. 71 tests pass across 13 files; funded browser send/reload/network-failure testing is not claimed.


## Experimental hardware signer - 23 October 2026

Added an isolated Ledger DMK/WebHID flow for the first Ethereum account and plain Sepolia ETH only. The local vault is neither decrypted nor switched by this flow. Device address display is requested, users compare the full address, then transaction details are reviewed in the browser and on the device. Returned signatures must recover the expected address and match the reviewed request. Expiry/session checks precede broadcast; the existing persist-before-broadcast journal records uncertainty.

Device operations can be cancelled; disconnect, navigation, hidden page and idle timeout invalidate the session. SDK blind-signing fallback is refused and blind-signing reporting disabled. No token, contract, arbitrary-message or delegation signing is exposed. These application checks do not defend against malicious application/SDK code, compromised browser/device firmware or a user approving different details on the device. Hardware support reduces host key exposure; it does not authenticate the webpage or guarantee transaction safety.

SDK-only network origins are explicitly allowlisted and HID limited to self in Permissions-Policy. No origin token/Transaction Checks coverage is configured. uuid/ws overrides patch vendor-pinned advisories; final npm audit is clear. 86 tests pass, production build passes, and browser UI/code loading were checked. Tests are mocks/disposable software signatures; physical USB access, device display, rejection/reconnect and funded disposable Sepolia transfers remain unverified. See README for sources, operation and exact limitations. No user/device funds were signed or broadcast during implementation.


## Production hosting preparation

Added a shared public-environment/header policy, production postbuild artifact scan and checksum manifest, immutable Node/Caddy image pins, restricted static hosting configuration, scoped CI checks and a release/reporting policy. 93 tests pass across 16 files; production build/release checks pass; npm audit reports no known advisories. The scanner is heuristic and does not prove absence of all credentials or malicious code. Docker/Caddy and public TLS were not run locally; CI jobs and real hosting checks remain pending. No deployment was performed. See DEPLOYMENT.md and SECURITY-POLICY.md.

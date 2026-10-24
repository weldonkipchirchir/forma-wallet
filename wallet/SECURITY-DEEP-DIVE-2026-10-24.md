# Security deep dive — Forma wallet

Review date: 24 October 2026 (Africa/Nairobi)

## Assessment

Forma remains experimental testnet software. This review found and fixed concrete weaknesses in secret-input handling, signed-transaction validation, backup parsing, network response handling and display validation. No direct remote fund-draining exploit was demonstrated. Absence of such a demonstration is not proof of safety. This is an engineering review with regression tests, not an independent audit or penetration-test certification.

## Scope and method

Reviewed the local Ethereum native/ERC-20, Bitcoin Testnet3, Solana Devnet/SPL, Ledger, recovery, browser lifecycle, public-data rendering and release-policy boundaries. Read the relevant signing and backup library implementations, examined the CI workflow and locked dependency versions, ran npm's advisory audit, tested hostile inputs and inspected public production HTTP headers. No user recovery phrase or password was collected. No funded transaction was signed or broadcast. GitHub/Vercel account access controls and physical hardware were not inspected.

## Findings and changes

| Finding | Risk and preconditions | Resolution |
| --- | --- | --- |
| Secret fields survived hidden locked pages and access-tab switches | Medium: a locally accessible browser or hostile same-origin code could recover entered passwords/phrases for longer than needed. Affects inputs even when no wallet is unlocked. | Scrub current and default DOM values, remove value attributes, remask shown inputs, reset show buttons, and clear revealed words on page hiding/exit. Scrub on restored page sessions and when leaving an access tab. Recovery phrase/BIP-39 passphrase fields no longer have a plaintext toggle. |
| Ethereum signature validation omitted nonce | Medium integrity gap: signed transaction could differ in nonce despite matching destination/value/fees. This could cause unintended replacement or execution ordering. No attacker-access path was demonstrated. | Require an explicit nonnegative integer nonce and compare signed bytes to the populated nonce, while retaining comparisons to originally reviewed destination, amount, calldata and fee fields. Native ETH, ERC-20 and Ledger share the check. |
| Lock/review state was not rechecked immediately before Ethereum signing | Medium: locking during an awaited population request could still allow local signing, although existing broadcast checks prevented subsequent sending. | Recheck wallet/view state and review age after population, before signing. Existing post-sign and pre-broadcast gates remain. |
| Bitcoin review binding omitted sequence/header policy | Medium integrity gap under transaction-object tampering. | Enforce version 2, zero locktime and final input sequences before signing, in addition to reviewed inputs, outputs, change, values and fees. |
| Network payload size was checked after buffering, or not bounded | Medium availability risk from hostile/compromised service responses. | Stream response bodies with a 2 MB cap, cancel oversized bodies, reject invalid UTF-8 and malformed JSON. Applied to custom Bitcoin/Solana requests, market, portfolio pricing and ETH activity. Ethers' internal RPC transport is a separate library boundary. |
| Solana JSON-RPC envelope was under-validated | Low/medium robustness risk: unrelated/malformed/error-bearing messages could reach result consumers. | Require version 2.0, the expected request identifier, an own result property and no error field. This is format/correlation checking, not proof that the provider is honest. |
| Optional encrypted mnemonic metadata bypassed explicit validation | Medium resource/recovery robustness risk from a hostile backup. | Bound entropy ciphertext/counter sizes, derivation path length/depth/index ranges, supported metadata version and English locale before decryption. Validate optional keystore address. Existing KDF work limits remain. Unsupported backups are rejected without replacing the current vault. |
| Native contact names allowed bidirectional control characters | Medium social-engineering risk: displayed contact names could mislead users. | Reuse the same control/direction-character validation used by Ethereum metadata and contacts. |
| Dependency declarations permitted version ranges | Supply-chain exposure during future dependency resolution; no malicious installed package identified. | Pin direct runtime and development dependencies to the already locked, tested versions; update root lock metadata. CI already uses npm ci --ignore-scripts, read-only permissions and commit-pinned actions. Pinning is defense in depth, not evidence that packages are benign. |
| Missing browser isolation headers | Low defense-in-depth gap. | Add same-origin opener/resource policies and regenerate Vercel configuration. Existing restrictive script CSP, anti-framing, no-referrer, nosniff and permissions policy remain. |

## Case studies informing the work

- [Halborn Demonic disclosure](https://www.halborn.com/blog/post/halborn-discovers-critical-vulnerability-affecting-crypto-wallet-browser-extensions) and [MetaMask's June 2022 security report](https://metamask.io/news/metamask-security-monthly-june-2022): browser session-restoration behavior can leave recovery secrets on disk under particular conditions. The DOM changes reduce retention; they cannot guarantee removal from browser snapshots, memory, swap or autofill. Disk encryption and a trusted device remain necessary defenses.
- [Ledger Donjon's Trust Wallet entropy analysis](https://www.ledger.com/blog/funds-of-every-wallet-created-with-the-trust-wallet-browser-extension-could-have-been-stolen): weak seed randomness can defeat every later encryption control. Forma relies on the libraries' cryptographic random source rather than implementing a new PRNG. This review did not perform a formal entropy assessment or certify the runtime.
- [Ledger Connect Kit incident report](https://www.ledger.com/blog/security-incident-report): compromised package distribution can replace legitimate wallet-facing code. Forma does not use the affected runtime CDN loader; dependencies are bundled. Exact versions, lockfiles, review and restricted publishing credentials are still necessary.
- [Trust Wallet's v2.68 incident update](https://trustwallet.com/blog/company/trust-wallet-browser-extension-v268-incident-community-update): a malicious published build bypassed the normal release process using compromised publishing access. The lesson extends beyond npm advisories: release-account security and mandatory review must be enforced outside this repository too. That report describes an ongoing investigation; it is not evidence of a matching compromise in Forma.
- [MetaMask address-poisoning guidance](https://support.metamask.io/id/stay-safe/protect-yourself/wallet-and-hardware/address-poisoning-scams/): never treat history as authenticated identity or trust only an address prefix/suffix. Ethereum already checks lookalikes; BTC/SOL still require full-address verification and do not have equivalent history-based detection.
- [OWASP HTML5 guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html): browser storage is accessible to same-origin JavaScript and must be treated as untrusted. Encrypted vaults protect against some offline disclosure, not malicious unlocked-page code.
- [OWASP transaction authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html): bind authorization to exact transaction details and recheck at execution. Applied here to client signing boundaries; a self-custody wallet must not send keys to an authorization server.

## Validation

- Full suite: 145 tests across 26 files passed after the changes.
- Added hostile-input coverage: oversized declared/streamed bodies and stream cancellation, malformed UTF-8/JSON, incorrect RPC envelopes, mnemonic metadata bounds, default/current secret scrubbing, nonce substitution, Bitcoin sequence substitution and direction-control contact names.
- TypeScript, production build and post-build release checks passed. Release checks verify expected headers, scan artifact secret markers and produce SHA-256 manifests. They cannot determine whether all bundled code is benign.
- npm audit returned zero reported advisories for 222 dependencies as counted by npm. Advisory coverage is incomplete and cannot detect unknown vulnerabilities or every malicious package.
- Public deployment check returned HTTP 200, restrictive CSP, DENY framing, nosniff, no-referrer, permissions restrictions and no-store HTML. The newly added opener/resource policies were absent on the deployed version at review time: local changes must be committed and redeployed. No deployment was performed.

## Remaining mainnet blockers and limits

1. An XSS flaw, malicious dependency, compromised deployment or malicious extension can read software-wallet keys while unlocked. CSP cannot protect against a malicious allowed bundle. A separate trusted signing boundary/hardware device and independent audit are required before claiming production readiness.
2. Browser autofill, crash recovery, OS swap and garbage collection are outside the application's reliable erasure control. Scrubbing is best effort. It is not a fix for a compromised device.
3. Copied encrypted vaults can be attacked offline. Password length checks are not equivalent to password entropy. Old downloaded backups keep old passwords after a password change.
4. Genesis/chain-ID checks and simulations do not prove RPC honesty or consensus. Production infrastructure, redundant-provider validation and confirmation/reorganisation testing remain necessary.
5. BTC/SOL Ledger signing is unavailable. Ethereum hardware signing needs physical-device testing. Funded native and token transfers, uncertain broadcast recovery and two-browser restore require end-to-end validation.
6. SOL token balances cover associated accounts, classic SPL only. Token-2022, arbitrary token extensions and recipient-account creation are unsupported. ERC-20 metadata and contract behavior remain untrusted; fee-on-transfer/rebasing/malicious contracts can differ from expectations.
7. Browser lifecycle protections and tests do not constitute a review of every external API, every library, operating-system attack, Vercel/GitHub access setting, or every rendering sink. Dedicated fuzzing, independent code review and release access review remain outstanding.
8. Mainnet remains disabled. Do not import funded mainnet phrases into this prototype.

## Release actions for the owner

Review this diff, commit wallet changes plus the generated Vercel policy, run CI, and redeploy. Verify the new headers on the public URL afterward. Require protected branches/reviews, strong account authentication, restricted deployment/publishing access and secret rotation if exposure is suspected. None of those remote account settings were changed here.

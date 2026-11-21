# REA MetaMask feature spec — 2026-11-20

Phase 0 output for porting selected MetaMask capabilities into Forma. REA was run against the installed MetaMask extension; Forma source was read separately.

## Target and evidence identity

| Item | Value |
|---|---|
| Target | MetaMask browser extension `13.53.0.0` (manifest `version_name` 13.53.0, MV3) |
| Install path | `C:\Users\weldo\AppData\Local\BraveSoftware\Brave-Browser\User Data\Default\Extensions\nkbihfbeogaeaoehlefnkodbefgpgknn\13.53.0.0_0` |
| Root artifact SHA-256 | `738f0c5974e803e8b4796c4ef7093d0657a847e2eb73049d9a260cf7fd9ef295` |
| REA Evidence ID | `ev_02023d4105f7ae68b789db55724c6bd4a33e269ae882d365d70aae4696b9557d` |
| REA version | `rea-agents@6.7.0` (skill v42, tool catalog 207) |
| Analyzed sources | `service-worker.js`, `scripts/inpage.js`, `scripts/contentscript.js` |
| Evidence JSON | `C:\Users\weldo\AppData\Local\Temp\opencode\rea-core.json` (145 MB; temporary) |
| MCP registration | Added to `C:\Users\weldo\.config\opencode\opencode.jsonc`; backup at `.rea.backup`. Client restart required before MCP tools load. |

REA statistics: 311 relevant files inventoried, 3 parsed; 4,614,208 text bytes; 1,289 webpack modules; 1,835 findings; 965,768 AST nodes; 60,224 semantic nodes and 26,229 semantic relations; 0 parse failures; no source maps.

## How to read the evidence

- `file.js L:C` = artifact observation (exact byte position in the shipped file, L = line, C = column). Selected files are minified, so column is the useful coordinate.
- `messages[key]` = `_locales/en/messages.json`, a structured artifact (3,908 keys) shipped in the same extension.
- `[REA]` = fact from the REA application graph / semantic graph.
- `[docs]` = public MetaMask documentation, not established by this artifact analysis.
- Anything not marked observed is an inference and is labelled as such.

## 1. Provider and permissions surface

Observed RPC literals (artifact):

| Method | inpage.js | contentscript.js | service-worker.js |
|---|---|---|---|
| `eth_requestAccounts` | 12:12128 | — | — |
| `wallet_requestPermissions` | 7:21656 | 14063:1384 | — |
| `wallet_createSession` | 12:3201 | — | — |
| `wallet_getSession` | 12:3060 | — | — |
| `wallet_invokeMethod` | 12:3515 | — | — |
| `wallet_revokeSession` | 12:3398 | — | — |
| `eth_sendTransaction` | — | 14063:594 | 14063:372 |
| `eth_sendRawTransaction` | — | 14063:641 | — |
| `personal_sign` | — | 14063:996 | 14063:774 |
| `eth_signTypedData` | — | 14063:729 | 14063:507 |
| `wallet_addEthereumChain` | — | 14063:288 | 14063:84 |
| `wallet_watchAsset` | 21:161 | 14063:1793 | 14063:1571 |
| `eth_decrypt` | 19:132 | — | — |
| `eth_getEncryptionPublicKey` | 20:166 | — | — |
| `eth_feeHistory` | — | 16555:283238 | not present |

`[REA]` `scripts/inpage.js` contributes 227 analyzed assets and preserves named functions `accounts` (22:13843, 7:24420) and `_handleAccountsChanged` (12:13145). `scripts/contentscript.js` is a 748-module webpack runtime (`[REA]` chunk summary) that forwards the full `eth_*` method set, including filters and subscriptions.

Observed behavior: the provider is permissioned and session-based (legacy `wallet_requestPermissions` plus CAIP-25-style `wallet_createSession` / `wallet_getSession` / `wallet_invokeMethod` / `wallet_revokeSession`). `wallet_announce`, `wallet_prompt`, `wallet_connect` and `wallet_disconnect` are also present in `inpage.js` (12:14442, 12:14579, 7:21596, 7:21613).

Forma implication: do not attempt a provider in the hosted SPA. This is Phase 5 only, requires an MV3 wrapper, a separate approval surface, and a method allowlist; every chain must be rejected except Sepolia (11155111). `[docs]` MetaMask also exposes EIP-6963 discovery; the artifact confirms the injected provider layer exists but does not prove the discovery announcement (not retained as a literal in the analyzed graph).

## 2. Accounts

Observed message keys and values:

- `accountDetails` = "Account details"; `addAccount` = "Add account".
- `addANickname` / `editANickname` = "Add a nickname" / "Edit nickname".
- `importAnAccount` = "Import an account"; `importAnAccountDescription` = "Via a private key".
- `importAccountMsg` = "Imported accounts won't be associated with your MetaMask Secret Recovery Phrase."
- `importAccountErrorIsSRP` = entering an SRP where a private key is required is rejected.
- `importAccountErrorNotAValidPrivateKey` / `importAccountErrorNotHexadecimal` = must be a 64-character hex string.
- `holdToRevealPrivateKey` = "Hold to reveal Private Key"; `privateKeyHidden`; `SrpListShowAccounts` / `SrpListHideAccounts`.

Interpretation: MetaMask keeps two account kinds in one account list — HD accounts derived from the SRP and standalone imported private keys that are explicitly not SRP-associated — with per-account nicknames and a guarded private-key reveal. `[REA]` accounts handling appears in both the inpage `accounts` paths and `_handleAccountsChanged`, confirming account switch notification is part of the provider contract.

Forma design (Phase 1): `AccountRecord.kind = 'hd' | 'imported'`; HD index derivation already exists in `importPhrase` (`src/wallet.ts:23`) and is capped at 100; standalone keys stay standalone with the "no recovery phrase" warning; reveal uses a fresh password re-entry instead of press-and-hold (stronger and consistent with `changePassword`); nicknames stored unencrypted like contacts.

## 3. Fees, nonce and replacement

Observed message keys:

- `advancedGasPriceModalTitle` = "Advanced network fee"; `advancedGasPriceTitle` = "Gas price".
- `advancedDetailsNonceDesc` = "Nonce"; `advancedDetailsNonceTooltip` explains sequential account nonces; `editNonceField` / `editNonceMessage` = "This is an advanced feature, use cautiously."
- Fee levels are named Low / Market / Aggressive: `alertMessageGasFeeLow`, `alertReasonGasFeeLow` = "Slow speed", `curveMediumGasEstimate` = "Market gas estimate graph", `curveHighGasEstimate` = "Aggressive gas estimate graph".
- Validation copy exists for max fee and priority fee being too low/high, and for zero priority fee.
- Replacement: `cancelTransactionTitle`, `cancelTransactionDescription` = "This transaction will be canceled and this network fee will replace the original.", `cancelSpeedupAlreadyConfirmedDescription`, `cancelSpeedupFailedDescription`; `attemptToCancelSwapForFree` is a separate swap flow.

`[REA]` `eth_feeHistory` appears in `contentscript.js` at 16555:283238 but not in the selected background bundle; fee/transaction controller logic is therefore likely in unselected vendor or UI chunks (unknown, see gaps).

Forma implementation (Phase 2, 21 Nov 2026): three presets — Economy (80% priority tip), Suggested (RPC `getFeeData` values) and Priority (150% tip, 130% fee cap) — are computed from the RPC's current EIP-1559 suggestion rather than `eth_feeHistory`. The reviewed nonce is pinned and rechecked before signing; a changed pending nonce or an unconfirmed local record at/above it stops signing. Native ETH journals now store gas limit, both fee fields and nonce, and Activity offers manual Speed up / Cancel replacements at the original nonce. Replacements raise both fields by at least 12.5% (ceiling) — Forma policy, because MetaMask's exact threshold is **not** established — and link original and replacement with `replaces` / `replacedBy`. Cancels send 0 ETH to self and still cost gas; confirmed/failed originals are rejected; nothing retries automatically. Not implemented: advanced custom fee/nonce inputs, cross-tab signing lock, and replacement for token, legacy or Ledger records.

## 4. Approvals, revocation and simulation

Observed message keys:

- `approveSpendingCap`, `approveIncreaseAllowance`, and full activity states `activity_approveSpendingCap_*`, `activity_increaseSpendingCap_*`, `activity_revokeSpendingCap_*` (pending / success / failed).
- `alertContentMultipleApprovals` = "You're giving someone else permission to withdraw your tokens, even though it's not necessary for this transaction"; `alertReasonMultipleApprovals` = "Unnecessary permission".
- Simulation labels: `confirmSimulationApprove` = "You approve", `permitSimulationChange_transfer` = "You send", `permitSimulationChange_receive` = "You receive", `permitSimulationChange_revoke2` = "Revoke", `permitSimulationDetailInfo` explains spender allowance, `revokeSimulationDetailsDesc` = "You're removing someone's permission to spend tokens".
- PPOM: `service-worker.js` contains `PPOM` at 14063:8281 (2 occurrences) and lowercase `ppom` 19 times from 14580:125437; the package ships `assets/ppom_bg.eb9c88441f051ebb0e9d.wasm` (3,339,542 bytes) — a static validation/simulation engine, not proof of what any single transaction will do.

Forma design (Phase 3): allowance discovery for tracked tokens, revoke-only `approve(spender, 0)`, basic `eth_call` simulation with revert surfacing, and explicit copy that this is not PPOM-grade coverage. Multiple/limitless approvals may be flagged, but no claim of comprehensive scam detection.

## 5. Networks

Observed message keys: `addNetwork`, `addACustomNetwork`, `addNetworkDescription`, `addRpcUrl`, `addBlockExplorer`, `currencySymbol`, and warning copy `addEthereumChainWarningModalHeader` / `PartTwo` / `ListPointOne…Three` ("malicious providers may lie about the state of the blockchain and record your network activity").

Decision (user constraint): Forma stays testnet-only and does not implement custom networks or `wallet_addEthereumChain`. Phase 4 is limited to a testnet banner and a full audit that every signing path calls `requireSepolia` (`src/wallet.ts:31`). The warning copy above is recorded as evidence of why the restriction is retained.

## 6. Assets, tokens and fiat

Observed message keys: `wallet_watchAsset` (provider method, see §1), token import/hide and NFT activity states, and `showFiatConversionInTestnets` / `showFiatConversionInTestnetsDescriptionV2` ("Shows network tokens as local currency on test networks"), plus `localCurrency`, `currencySymbol`.

Forma design (Phase 4): opt-in token detection from existing Blockscout data with "unverified" labels, one-click add, spam heuristics; fiat allowlist applied to market/portfolio labels only. Token spend/price claims stay unavailable for test assets.

## 7. Security and UX controls

Observed message keys: `autoLock`, `autoLockAfter15Seconds`, `autoLockAfter30Seconds`, `autoLockAfter1Minute`, `autoLockAfter5Minutes`, `autoLockNever`, `autoLockTimeLimit`; `connectedSites`, `connectedSitesDescription`, `disconnectAllSites*`; `permission_ethereumAccounts` = "See address, account balance, activity and suggest transactions to approve"; `phishing` appears 12 times in `service-worker.js` from 14580:139088; `Snap` 59 times from 14082:22604; `smartTransactions` messaging; `backupAndSync*` describes encrypted cloud backup.

`[REA]` storage observations in `service-worker.js` include `sessionStorage.setItem` (14563:35126), and 9 network endpoint candidates were inferred (low confidence). Snaps are a sandboxed MV3 page (`manifest.sandbox.pages = snaps/index.html`, `snaps/` present).

Forma design: configurable auto-lock timer is a small Phase 4 win (current fixed five minutes); no cloud backup/sync, no snaps, no smart-transaction relay. Phishing strings are evidence that MetaMask layers address/contract reputation into its confirmation UI; Forma has no equivalent data source and must not claim it.

## 8. Deliberately out of scope (with evidence, not absence)

- Swap, bridge, stake, ramp and perps surfaces exist: 815 matching message keys, plus `bridge` 82 times and `swap` 5 times in `service-worker.js` from 14082:34456 / 14082:38897. They require mainnet liquidity, third-party APIs and real funds, so they are excluded by the approved testnet-only constraint.
- Snaps plugins (sandbox + 91 keys) are excluded; a SPA cannot host them.
- Connected-sites management is only meaningful with the Phase 5 provider.

## 9. REA gaps and next probes

Limitations returned by REA (verbatim scope facts):

- 308 inventoried files were outside the selected analysis scope; relationships through them remain unknown.
- The analysis is inert text only; bundle bootstrap was never executed.
- Static relationships do not prove runtime execution; dynamic/obfuscated paths may stay unresolved.
- No source maps were present, so names are minified; REA did **not** project string literals into the graph, so feature identification relies on artifact text plus message catalogs.

Next probes (after the MCP restart):

1. `analyze_javascript_application` on `ui.17571a42eecbd4fe916f.js` and the larger vendor chunks to locate fee/approval/account controllers that the background bundle does not expose.
2. `trace_application_feature` seeds of kind `module` for chunk candidates, and `node-id` seeds from the current Evidence.
3. Optional runtime observation of the installed MetaMask popup to confirm fee-level and approval flows before copying any UX.
4. `recover_javascript_sources` is unavailable on this host (requires Wakaru ^1.13.0 Linux x64 via `REA_WAKARU_COMMAND`); do not plan around it.

## 10. Reproduce

```powershell
npx -y rea-agents@6.7.0 doctor --client opencode --json
npx -y rea-agents@6.7.0 analyze-javascript-application "<extension dir>" `
  --source-path service-worker.js `
  --source-path scripts/inpage.js `
  --source-path scripts/contentscript.js `
  --format json > "$env:TEMP\opencode\rea-core.json"
```

MCP is registered but this session predates it; restart opencode to load the REA tools.

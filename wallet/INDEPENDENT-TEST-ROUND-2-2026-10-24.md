# Independent test round 2 — 24 October 2026

Three agents independently reviewed overlapping signing, recovery, network and error-handling flows. Two focused on code and reproducible synthetic probes; one exercised the browser using an isolated localhost disposable wallet. The primary agent compared findings and ran the complete suite, build and dependency audit. This is internal testing, not an independent external audit.

## Test results

- Initial parallel full-suite run: 145/147 tests passed; two tests exceeded the default five-second timeout during encrypted recovery and Vite configuration loading. No assertion failures in that run. Another reviewer also reproduced timeout-only failures under concurrent load.
- Full rerun with `npm.cmd test -- --maxWorkers=2 --testTimeout=30000`: **150/150 tests across 27 files passed**, including three new journal regressions.
- Independent focused reruns: 19/19 and 45/45 passed with bounded concurrency/increased crypto-test timeouts. The journal helper tests were separately rerun by another agent: 3/3 passed.
- Additional ignored synthetic probes verified signing revocation during an awaited Solana signing operation and demonstrated owner-only signature discovery. These probes were not part of the 150-test total.
- Dependency audit reported zero published advisories. Production build and release checks passed after fixes for seven artifacts. Existing large-chunk and third-party annotation warnings remain.

## Findings fixed in this round

1. **Journal status coverage:** native status refresh inspected only the first 20 records, while the sending guard inspected the full journal. Unresolved records outside that window could never be refreshed. Refresh now always includes unresolved records plus the latest 20 resolved records. This is a demonstrated persisted-state case; the normal per-account unresolved gate makes it harder to create through sequential sends alone.
2. **Journal retention:** retaining the latest 100 entries could silently discard an older uncertain submission. Retention now gives pending/unknown records priority, replaces records by chain and ID, and rejects unresolved overflow rather than losing the safety record. No automatic retry or dismissal was added.
3. **Ethereum network switch:** unlocking on SOL/BTC then switching to ETH left balance/history unloaded until manual Refresh. Both network controls now initiate Ethereum reads and guard repaint against subsequent navigation.

## Independently confirmed open findings

### Ethereum nonce coordination — high priority before mainnet

ETH and ERC-20 signing lack a shared cross-tab send lock and unresolved-submission gate. Ethers' pending nonce query does not reserve a nonce. Two tabs can prepare distinct reviewed transactions with the same nonce before either broadcast; rejection/replacement ambiguity can follow. Two reviewers independently confirmed the control-flow gap. No funded double-send was attempted.

A complete fix must coordinate software ETH, ERC-20 and Ledger paths for the same address, check both journals under the lock, and verify Ledger's review-time nonce before signing. Locking only one path would leave the gap open. This was recorded rather than partially patching one signing path.

### Incoming SPL history — confirmed missing discovery

Solana history fetches signatures for the wallet owner only. A normal TransferChecked to an existing associated token account includes the destination token account, not necessarily the recipient wallet. A synthetic compiled transaction confirmed recipient-wallet absence and destination-ATA presence. Another probe confirmed there is no token-account signature query. Therefore supported incoming SPL transfers may be absent even though the movement parser works when given the transaction.

A fix requires bounded token-account discovery/signature fetching, deduplication and clear coverage/failure indicators. Current balances may still be correct; history completeness must not be inferred from them.

### Other remaining items

- Expired/dropped Solana submissions can stay unknown and block sending indefinitely. This round's journal coverage fix does not establish expiry or authorize retrying them.
- Legacy separate-vault errors/native transfer errors still use a top-of-panel status instead of the primary login's inline red alerts.
- Bitcoin's disabled Tokens tooltip incorrectly says Ethereum-only despite Solana SPL support.

## Browser checks

Wrong-password feedback placement, red colors in both themes and alert focus; Restore/Saved tabs; synthetic unlock; network-specific headings/addresses/controls; tracked wrapped-SOL zero/no-ATA display; invalid SOL recipient rejection; invalid recovery phrase rejection with cleared field; and lock removal of account workspace/sidebar passed.

No real funds, user secrets or recovery phrases were accessed. Full funded ETH/BTC/SOL/ERC-20/SPL roundtrips, actual Ledger hardware, mobile viewport emulation and real screen-reader announcements remain unverified. Backup identity preservation was tested by automated fixtures; browser backup-file roundtrip was not repeated here. Keep the app testnet-only.

The Ethereum auto-refresh fix passed TypeScript/build checks and independent source review of both controls and stale-result guards. The browser became unavailable before a live retest, so that fix is not claimed as browser-verified. The full 150-test run preceded this final UI-only patch; its final validation was build plus source review.

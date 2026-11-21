# Forma — self-custody wallet prototype

Standalone browser wallet. The existing event app is unchanged.

One primary wallet unlocks Ethereum Sepolia, Bitcoin Testnet3 and Solana Devnet accounts from the same recovery phrase and encrypted backup, and can hold several Ethereum accounts derived from that phrase or imported as standalone private keys. The Network selector keeps Overview, holdings, transfers, Activity and Market on the chosen network across navigation and reloads. Older separate BTC/SOL vaults are preserved in normal Saved wallets; use the standard unlock, encrypted-backup or recovery-phrase restore flow. See [MULTICHAIN.md](MULTICHAIN.md) for recovery, migration, supported paths and limitations. The USD portfolio estimate remains Ethereum-specific.

## Run

Requires Node 24.x.

```powershell
cd D:\event-flow-app\wallet
npm install
npm run dev
```

Open the localhost URL Vite prints. `npm run build` typechecks and builds; `npm test` checks validation and encrypted-keystore recovery.

## First session

1. Create a fresh test wallet with a password of at least 12 characters.
2. Download the encrypted JSON backup. Keep its password separately; there is no password reset.
3. Use the receive address on Ethereum Sepolia only. Acquire test ETH through a Sepolia faucet independently; the app does not sell tokens.
4. Enter a literal recipient address and amount, review the fee preset, pinned nonce and worst-case fee, then explicitly confirm.
5. Open Activity to sync incoming and outgoing direct transactions and internal ETH transfers from Sepolia Blockscout. Activity is cached per address across reloads and locks. Load older activity to paginate; the local cache retains up to 1,000 records. Tokens are not included. Check the explorer for complete on-chain activity and final status.
6. Lock and unlock to test local recovery. Recovery & import lets you reveal an available recovery phrase after password verification (hidden automatically after 30 seconds), import encrypted JSON, or import a BIP-39 phrase. Phrase import uses m/44'/60'/0'/0/index, index 0 by default; optional BIP-39 passphrases are supported. Other derivation paths and non-English wordlists are not supported.
7. Imports preserve the previously active encrypted wallet. Select it under Saved wallets and unlock it with its own password to switch back. Raw-private-key JSON backups may not contain a recovery phrase; keep their encrypted backup instead.
8. Manage several accounts inside the unlocked wallet under Recovery & import > Accounts: derive the next phrase-backed account, import a 64-character private key, rename accounts, reveal the active private key after password re-entry, or download a per-account encrypted backup. The header account selector switches accounts without re-entering the password while the wallet stays unlocked.

When importing with a non-empty BIP-39 passphrase, the standard ethers JSON backup preserves the account key but does not include mnemonic metadata. Phrase reveal will therefore be unavailable for that backup. Keep the original phrase and BIP-39 passphrase separately; the encrypted JSON and local password still recover the imported account. Because Forma does not retain the passphrase, additional accounts cannot be derived from that wallet; import each private key instead.

## Multiple accounts

Overview's header account selector and Recovery & import > Accounts manage several Ethereum accounts inside one unlocked wallet. Phrase-backed accounts are derived from this wallet's recovery phrase at `m/44'/60'/0'/0/index`; the next unused index is suggested, with indexes 0-100 and up to 100 accounts per wallet. Activity, contacts, tracked tokens, submission journals and backup status remain keyed by address, so switching accounts never mixes their local records.

Imported private keys are standalone: they share this wallet's local password and unlock with the same session, but the recovery phrase does not restore them and another account's encrypted backup does not contain them. Download each imported account's backup from the account list. Entered values must be 64 hexadecimal characters; the importer rejects recovery phrases. Unlocked keys, including imported ones, exist only in JavaScript memory until lock.

The account registry (`forma.sepolia.accounts.v1`) stores addresses, account kinds, derivation indexes and nicknames unencrypted. Each account's encrypted keystore is stored separately (`forma.sepolia.account.vault.v1:<address>`); the active account is also mirrored at `forma.sepolia.vault.v1` for compatibility. Unlocking a pre-existing single vault migrates it idempotently into a group without re-encrypting it. Changing the wallet password re-encrypts every account in the group; if a legacy copy uses a different password, switching to it falls back to the normal locked unlock for that account.

Account backups cover one account each. Phrase-backed accounts can additionally be re-derived from the recovery phrase; imported keys cannot. The recovery phrase and per-account encrypted backups remain the only recovery paths.

## Fees, nonces and replacements

The ETH review shows a pinned nonce and three EIP-1559 fee presets derived from the RPC's current suggestion: Economy (80% priority tip), Suggested (RPC values) and Priority (150% priority tip and a 30% higher fee cap). These are Forma estimates, not MetaMask's algorithm and not a promise of confirmation time. The worst-case fee is recalculated when the preset changes, and an unaffordable preset disables confirmation.

Signing rechecks the account's pending nonce. If it changed, or another unconfirmed locally recorded transfer already occupies the reviewed nonce, signing stops and the transfer must be reviewed again. New ETH transfers store the gas limit, both fee fields and the nonce in the local journal so they can later be replaced.

Activity's locally submitted ETH rows expose Speed up and Cancel while a transfer is unconfirmed. Both build a new type-2 transaction at the original nonce: speed-up keeps the recipient/value, while cancel sends 0 ETH to your own address and still costs gas. Forma raises both fee fields by at least 12.5%, rounded up; this threshold is Forma policy, not an established MetaMask rule. Only one transaction can be mined per nonce, so the original can still win. Each replacement is a new journal record linked to the original, and no automatic retry occurs.

Replacement is limited to native ETH records with recorded fee details; older records and token transfers cannot be rebuilt safely. There is also no cross-tab signing lock, so separate open tabs can still prepare competing nonces.

## Design and limits

## Market view

Market shows real Binance spot ETH/USDT, BTC/USDT or SOL/USDT prices for the selected network. Test coins are never assigned monetary value. Public market requests contain only the market symbol and timestamps; no wallet address or secret is sent to Binance.

- Last traded ETH/USDT price and exchange-reported rolling 24-hour change refresh every 15 seconds.
- 1H, 24H, 7D, 30D, 90D, 180D and 1Y comparisons use the open of the one-minute candle nearest the rounded-down lookback timestamp and the current last price. These approximate lookback changes refresh their baselines every minute; the exchange's 24-hour calculation can differ slightly.
- Candles refresh every 30 seconds, with intervals from 1 minute to 1 day depending on the range. Hover for OHLC/volume, drag to pan, scroll/pinch to zoom, and Reset chart to fit the selected range. Candle timestamps are UTC; the latest candle is incomplete.
- The chart uses TradingView Lightweight Charts; required attribution is displayed. The source is Binance public market-data-only REST, not a trading account or order execution API.
- Regional restrictions, CORS, outages and rate limiting may prevent data loading. Errors and stale prices are labelled; no sample data is substituted. Polling pauses while the document is hidden and is disposed when leaving Market or locking the wallet.

## Additional design limits

Appearance is available in the header while locked or unlocked: System follows device appearance, while Light and Dark persist a local override. Switching themes preserves form inputs and wallet state. See SECURITY.md for the security review and production deployment requirements.

- Desktop sidebar collapses to an icon rail and remembers that preference. Mobile uses a menu drawer closed with its backdrop or Escape. Navigation has accessible labels, keyboard focus indicators and reduced-motion styles.
- Activity supports All, Received and Sent filters. Page headings and breadcrumbs follow the selected view; long-running actions show working feedback.

- ethers creates and encrypts wallets with its standard JSON keystore encryption. Private keys are persisted only inside encrypted keystores. Account metadata (addresses, kinds, indexes, nicknames), journals, contacts, preferences and cached activity are stored unencrypted in localStorage. No private key or password is sent to a backend.
- Unlocked keys exist in JavaScript memory. Locking drops application references but cannot guarantee memory erasure in a garbage-collected browser.
- The app locks on tab hiding and after five minutes idle. Reloading starts locked.
- Only chain ID 11155111 is allowed. Review validates address, precision, balance and maximum gas. Blockchain node responses are still a trust dependency.
- Optional `VITE_SEPOLIA_RPC_URL` is public configuration; never include private credentials. The default public RPC may rate limit or be unavailable. The RPC operator can observe addresses and requests.
- History queries send your public address to Sepolia Blockscout. That indexer can observe requests and may lag or be unavailable; the UI reports partial failures and retains cached data. Cached transactions and saved wallet addresses are public-chain data stored unencrypted locally. Recovery phrases are never stored as plaintext or sent to either service.
- No backend, analytics, external fonts, key escrow, swaps, M-Pesa, cards or mainnet support.
- This is an unaudited development prototype. Never import a wallet that holds real assets. A testnet wallet uses keys that can also control mainnet addresses, even though this UI blocks mainnet.
- Browser storage, dependencies, malicious extensions and XSS are security boundaries. Public deployment needs threat modelling, dependency review, CSP and security headers, reproducible builds, recovery UX review and independent security assessment.
- There is no automatic transaction retry. If submission fails after broadcast, inspect the explorer before trying again to avoid duplicate transfers.

## Next milestones

Browser automation of create/unlock/restore/review flows; recovery phrase backup verification; accessibility review; hardened deployment; independent security assessment before considering mainnet.

ALL market range uses monthly candles from the earliest Binance ETH/USDT listing data, with a comparison against that first monthly open. This is provider listing history, not Ethereum network launch history.

## Hypothetical portfolio USD analytics

Portfolio applies Coinbase ETH-USD prices to test ETH quantities for simulation only. These are not real Sepolia asset values. The ticker refreshes every 30 seconds; historical deposits use the minute candle open at the transaction timestamp. It shows estimated remaining weighted-average basis, hypothetical unrealized USD and percentage change, earliest loaded deposit date, and the latest 25 loaded deposit valuations. Withdrawals remove average basis proportionally; fees, realized gains, tax basis and external acquisition costs are excluded. Values depend on loaded records; partial history can produce incomplete estimates. Load older Activity pages and refresh. At most 200 deposit prices are fetched per view; larger histories withhold P/L. Missing prices also withhold P/L. USD queries share market symbol/timestamps with Coinbase, not wallet addresses or secrets. Hide holdings masks valuation figures too. Leaving Portfolio or locking cancels requests.

## Sepolia ERC-20 tokens

Open Tokens and import a contract address deployed on Ethereum Sepolia. The app reads name, symbol, decimals and balance from the contract and stores up to 25 tracked contracts per wallet. Only 0-36 decimals and standard string metadata are supported. Addresses, units and metadata are validated, with HTML escaping on display. Token names/symbols remain unverified and are not proof of authenticity or liquidity.

Receive at the same wallet address as ETH; import is only for display and never moves funds. Portfolio lists tracked token balances, separately from the native-ETH-only hypothetical USD calculation. Test tokens have no assigned USD price or P/L.

To send, choose a token, enter recipient/amount, review contract address and maximum Sepolia ETH gas fee, then explicitly confirm. The app calls only transfer(address,uint256), not approve. It simulates the transfer, checks token and ETH balances, signs locally, and checks active-wallet state before broadcast. A transfer can still fail or have different effects with fee-on-transfer, rebasing, blocked or malicious contracts. No live transfer was submitted during implementation testing.

Token history is loaded from Blockscout ERC-20 events, filtered to tracked contracts, with pagination up to 1,000 loaded events. It may lag; the submitted transaction link is provided immediately. Token metadata persists locally; history is reloaded from the indexer when the Tokens view opens. If no events appear, use Load older token transfers to search older indexed pages. Standard ETH activity and token activity are separate views. Leaving Tokens or locking cancels its UI updates and prevents a not-yet-broadcast transfer from being submitted. A transaction already broadcast cannot be cancelled by locking.

Browser verification imported Circle's documented Sepolia test USDC contract `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, read its metadata and zero balance, and verified insufficient-token-balance rejection. Reference: https://developers.circle.com/stablecoins/usdc-contract-addresses . This only adds tracking; it does not acquire or mint tokens.

## Recipient checks and hidden assets

ETH and token reviews expire after two minutes. Verify the full recipient address/network using the acknowledgement in the review. Self-sends warn about gas; recipients similar to loaded outgoing-history addresses are blocked using a first-four/last-four-character heuristic. No contact or address is certified safe by this check.

Tokens supports Hide token and Show hidden/Unhide token. Hiding only changes the local display and send selector; it does not move, burn or delete assets. Token metadata with direction-control characters is rejected. Simulation is a basic RPC eth_call check, not enforced onchain outcome protection.

## Research and adversarial regression review

See [SECURITY-RESEARCH-2026-10-22.md](SECURITY-RESEARCH-2026-10-22.md) for the wallet comparison, primary research, fixes, test evidence and remaining release requirements. Encrypted JSON imports now require a fresh confirmed local password; the original password only decrypts the uploaded backup.


## Backup verification, password changes and token submissions

Under Recovery & import, Verify your backup decrypts an uploaded encrypted JSON and checks that its address matches the unlocked wallet. It does not import or replace that wallet. Select a backup under 100 KB and enter that backup's password.

Change wallet password requires the current password and a matching new password of at least 12 characters. It re-encrypts every account in the current wallet group (imported keys included), updates saved-wallet entries and locks the wallet. Unlock with the new password, download a new backup from Overview, then verify that file. Older downloaded backups still use their original passwords. Other saved wallets keep their passwords. A password change does not revoke a compromised seed/private key or old backup.

Tokens includes Submitted token transfers. Before broadcast, the app stores the signed transaction's hash and public transfer details (not signed bytes or keys) in a wallet-specific journal. If local persistence fails, broadcast is blocked. An ambiguous network response retains Unknown; an accepted response becomes Pending. Opening Tokens or clicking Refresh history reconciles records against RPC receipts. Missing receipts are never treated as failed; records can return to Unknown if a receipt disappears. There is no automatic resubmission, replacement or cancellation. Inspect the explorer before retrying. Browser-data deletion removes this local journal; it is not an onchain record or independent proof of finality.

Validation on 23 October 2026: 50 tests across 10 files pass, including recovery ownership/wrong-password checks, password re-encryption, archive rollback and hostile/ambiguous token journal cases. Production build passes with its existing bundle-size warning. Browser checks confirmed the recovery forms and submission panel render; the user's actual password was not changed and no token transfer was broadcast. Cryptographic changes were exercised only with disposable test keys.


## Verified contacts

Open Contacts in the sidebar. Save a name and full Sepolia address only after confirming both directly with the recipient and checking the acknowledgement. Contacts are stored unencrypted in this browser, separately per wallet; history never creates contacts automatically. Saved recipient selectors on ETH and token forms fill the literal destination. Review shows the saved name, full address and user-confirmation date. Exact contacts are not independently authenticated, and local storage can be modified by compromised same-origin code.

The contact guard blocks destinations sharing the first four and last four hexadecimal characters with a different saved contact. This is a heuristic, not comprehensive scam detection. Changing a contact address requires removal (with a second confirmation click) followed by fresh verification. Duplicate names/addresses and zero addresses are rejected; at most 100 contacts are supported per wallet. Another tab changing the current wallet's contact list locks this tab to invalidate open reviews. Watch-only accounts remain a later milestone.


## Watch-only accounts

Open Watch-only from the sidebar, or Watch-only accounts - no unlock needed on the locked screen. Add a name and public Sepolia address, then select an account to view its exact ETH balance, manually tracked ERC-20 balances and recent direct/internal ETH history. The full explorer link provides older history; token transfer history is not included here. Up to 20 accounts and 25 tokens per watched account are supported. Account removal needs a second confirmation click; previously tracked public token metadata remains locally cached for that address.

Watching does not prove ownership and cannot sign or send. No seed, private key or password is requested. The watch view gets a read API only; signing forms are not rendered in that view. While unlocked, Back to my wallet returns to the separate signing wallet; while locked it returns to the unlock screen. Adding watched accounts never replaces the active vault. Watch-specific token lists do not modify signing-wallet token lists. Names, watched addresses and token metadata are stored unencrypted on this device and persist across reloads; deleting browser storage removes them. RPC/Blockscout can see requested addresses and connection metadata. The balance-hiding preference also masks watched balances and amounts.

Validation: 60 tests across 12 files pass, including named-public-address validation, storage/duplicate limits, read-API isolation, wrong-network rejection, exact token balances, merged ETH activity and partial provider failures. Build passes with the existing bundle-size warning. Read-only browser checks used the existing public test wallet address and confirmed 0.05 Sepolia ETH and its faucet receipt while the signing wallet stayed locked. No funds were signed or sent.


## Submission reliability and uncertain transfers

ETH now uses the same persist-before-broadcast helper as token sends. The app records hash, destination, amount, nonce when available and timestamp before calling the RPC. No raw signed bytes, passwords or keys are stored in the journal. Storage failure or an invalidated session/review before broadcast stops the send. A timeout, unexpected RPC hash or acknowledgement-write failure retains an Unknown record; the app never retries automatically. Locking after network handoff cannot recall a transaction; acknowledgement can still be recorded against the original wallet.

Activity shows Locally submitted ETH; Tokens shows Submitted token transfers. Refresh activity/history to inspect receipts. Success/failure receipts show confirmation counts supplied by the RPC, not a finality guarantee. If a receipt disappears, status may revert to Pending or Unknown. If the hash is absent and the latest mined account nonce exceeds the recorded nonce, the UI flags possible replacement or RPC inconsistency; it cannot identify a replacement hash. A hash absent from this RPC after ten minutes is only Not currently seen, never proven dropped. Verify the explorer and all account activity before manually sending again.

Receipt checking is limited to four records concurrently and refresh merges preserve newer records written while requests were in flight. Cross-tab localStorage writes are not transactional. Clearing browser storage removes local records. There is no automatic cancellation, speed-up or replacement search across blocks; same-nonce speed-up/cancel is a manual native-ETH action. Token replacements, hardware signing and independent chain-finality verification are unavailable. Legacy records without nonce metadata can still be checked for receipts but cannot receive nonce-use hints or be replaced.

Validation on 23 October 2026: 71 tests across 13 files, including disposable signed fixtures and mocked broadcasts for timeouts, storage failure, session/review invalidation, post-handoff locking, reload persistence, receipt loss, confirmation counts and nonce conflicts. No user's wallet was used to sign or broadcast during these tests; a live funded disposable-wallet network interruption exercise remains outstanding.


## Experimental Ledger signing (Sepolia ETH only)

Open Ledger in the sidebar, or Use Ledger - no seed import on the locked screen. The local encrypted wallet does not need to be unlocked and is not replaced. Use a compatible desktop browser with WebHID on HTTPS/localhost. Unlock your Ledger, open the Ethereum app, click Connect Ledger & verify address, choose the device in the browser picker, and approve displaying its address. Compare the complete address with the device and check the address acknowledgement. The only supported path is m/44'/60'/0'/0/0.

Enter a literal recipient and a positive Sepolia ETH amount, then review sender, destination, value, network and maximum fee. A second acknowledgement is required before requesting device approval. Verify the details on the Ledger display. Do not enable blind signing. Native type-2 Sepolia ETH transfers with empty calldata/access/authorization lists are the only supported requests. Token/contract calls, arbitrary messages, typed-data/delegation signing and other chains are rejected or unavailable. No seed/PIN input or private-key import is used in this flow.

The returned signature is bound to the reviewed transaction and expected device address before broadcast. Reviews expire after two minutes; recipient edits, cancellation, disconnect, hidden page, navigation and five minutes idle invalidate the session/review. Device requests time out after two minutes. A transaction already handed to the network cannot be recalled. Public submission details are recorded before broadcast against the device address, using the existing native ETH journal. Refresh Ledger submissions checks receipts, confirmations and uncertain nonce-use outcomes; no automatic retry occurs.

Implementation uses Ledger's maintained Device Management Kit 1.11, WebHID transport 1.2, Ethereum signer 1.18 and context module 2.8, loaded on demand. See Ledger's [general migration guide](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/ledgerjs-to-dmk) and [Ethereum integration guide](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/migrations/signers/eth/hw_app_eth_to_dmk). Their documentation directs new integrations to DMK. No application origin token or Transaction Checks service integration is configured, so Forma does not claim Ledger risk-scanning coverage. The app refuses the SDK's blind-signing fallback and disables its blind-signing reporter.

CSP permits manager.api.live.ledger.com and global.api.prd.ledger.com for Ledger SDK services; device/transaction metadata may be disclosed by those services. Browser HID access is scoped to this origin. Actual device compatibility, browser permission behavior, firmware/Ethereum-app combinations, service/CORS behavior and on-device clear display still require physical testing. Origin WebHID availability and successful code loading are not proof that a connected device works.

Dependency review found pinned transitive uuid/ws advisories in the SDK tree. Package overrides now require uuid >=11.1.1 within major 11 and ws >=8.21 within major 8. They keep the vendor's ethers pin while patching its WebSocket dependency. npm audit reports zero known advisories. Review these overrides when updating Ledger packages; do not remove them without re-auditing. One upstream transitive package (CryptoJS) is marked deprecated by npm; this is not itself an audit advisory.

Validation on 23 October 2026: 86 tests pass across 14 files; production build passes with >500 KB chunk warnings. The approximately 657 KB Ledger SDK chunk is lazy loaded. Tests use disposable software signatures and mocked SDK action observables for rejection, cancellation, disconnects, timeouts, missing approval, blind fallback and signature mismatch. Browser check confirmed the SDK loads and Connect becomes available while local wallet remains locked. No HID permission was requested, no device was connected, and no user transaction was signed or broadcast. Physical-device approval/transfer verification remains outstanding; this integration is explicitly experimental.


## Login and Ledger interface refresh

The login screen uses a dedicated unlock card, local-vault illustration and separate Ledger/watch-only entry buttons. The Ledger screen separates connect/verify and review/approve into two cards, groups connection details in an expandable section and disables transfer fields until a device address is available. Layouts stack at smaller widths and support light/dark themes. Existing form IDs, password hiding, device acknowledgements and signing policies remain in place.

Validation: 86 existing regressions and the production build pass. Desktop browser checks covered both themes, login unlock/lock, alternate navigation and the Ledger connection-ready state. No hardware device permission was requested or funds sent. Responsive CSS is implemented; physical mobile-browser testing and a full accessibility audit were not performed.


## Production hosting preparation

See [DEPLOYMENT.md](DEPLOYMENT.md) for the reviewed Caddy/Docker configuration, production build guards, immutable image/action pins, CI checks, hosting smoke checks and release gates. See [SECURITY-POLICY.md](SECURITY-POLICY.md) for private vulnerability reporting. `npm run build` now scans built files and generates production headers plus SHA-256 checksums in `.release/`. Nothing has been deployed; container/public TLS and hosted CI execution still need validation.


## GitHub Actions and Vercel

Vercel static hosting is configured in vercel.json with test/build/audit gates and production headers. Follow [VERCEL.md](VERCEL.md): the current repository keeps wallet/ as the Vercel Root Directory, Node 24, and Other framework preset. GitHub Actions exposes Tests, build and security plus Caddy container and hosting checks under Wallet checks. Local validation on 21 November 2026: 180 tests across 32 files and the production release build pass. No push or deployment has been made.

### Solana SPL tokens

Select Solana Devnet, then Tokens. Add a classic SPL mint address, refresh the associated-account balance, and review transfers to a wallet with an existing associated token account. Mint identity, decimals, account ownership and state are validated. Fees remain in devSOL. Token-2022, recipient account creation and BTC/SOL Ledger signing are not implemented. See MULTICHAIN.md for transfer safeguards and remaining funded tests.

### Additional EVM networks and tokens

The network selector also includes Base Sepolia (84532), Arbitrum Sepolia (421614), OP Sepolia (11155420), and Robinhood Chain Testnet (46630). These use the selected Ethereum account address and encrypted backup. Each network has its own balances, imported ERC-20 contracts, and local submission journal, scoped by chain ID and account. ETH pays gas on these four testnets.

Select a network, open Tokens, paste a standard ERC-20 contract deployed on that network, and choose Import token. Up to 25 contracts can be tracked per account/network. Metadata and balances are read from the contract. Symbols such as USDT or USDC are unverified labels; a test token is not redeemable mainnet stablecoin. Native SOL remains on Solana; wrapped SOL on an EVM chain is a separate contract. Adding a token does not move or bridge funds.

The additional EVM workspace supports native ETH and standard ERC-20 transfer reviews, receive QR codes, hidden balances and locally submitted transfer status. Incoming/full network history is linked through the explorer. Sending uses a per-chain/account Web Lock and blocks while a local submission is pending or uncertain. Wrong-chain RPC responses and signed bytes that differ from the review are rejected. L2 chains can charge data fees beyond execution-gas estimates. Hardware signing, contacts/watch-only, swaps, bridges, token discovery, nonstandard tokens and mainnet are not enabled on these added networks.

Official network references: [Base](https://docs.base.org), [Arbitrum](https://docs.arbitrum.io/arbitrum-essentials/reference/node-providers), [Optimism](https://optimism.io/blog/op-testnets-are-migrating-from-op-goerli-to-op-sepolia), [Robinhood Chain](https://docs.robinhood.com/chain/add-network-to-wallet/).


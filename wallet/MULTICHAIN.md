# One wallet: Ethereum, Bitcoin Testnet and Solana Devnet

Create or unlock your primary wallet once. Use **Network** in the header or **Your wallet accounts** on Overview to switch between Ethereum Sepolia, Bitcoin Testnet3 and Solana Devnet. Bitcoin and Solana no longer ask for a second password or create another vault.

## One phrase and backup

Fresh wallets derive all three first accounts from the same BIP-39 recovery phrase. Each network has a different receiving address:

| Asset | Network | Path | Receive format |
| --- | --- | --- | --- |
| ETH / ERC-20 | Ethereum Sepolia | `m/44'/60'/0'/0/0` by default | `0x...` |
| tBTC | Bitcoin Testnet3 | `m/84'/1'/0'/0/0` | Native SegWit `tb1q` |
| devSOL | Solana Devnet | `m/44'/501'/0'/0'` | Solana base58 public key |

The existing encrypted primary backup preserves the recovery entropy and restores these accounts. **Download wallet encrypted backup** from any network produces the same primary-vault JSON. Restore it with its backup password, choosing a new local password if desired. Password changes re-encrypt the same keys and preserve all addresses. No plaintext phrase or key is stored in localStorage.

Imported raw Ethereum-key backups cannot derive BTC/SOL accounts. BIP-39-passphrase imports are also excluded from the shared flow because the current ethers encrypted JSON cannot preserve their mnemonic metadata. These imports retain their Ethereum address, password and backup; the UI explains the limitation instead of generating unrelated accounts. Account indices beyond the default Ethereum account remain Ethereum-specific; Bitcoin and Solana derive their fixed first accounts from the shared phrase.

Locking the primary wallet locks all three networks. Navigating between networks releases the previous module's signing references but uses the same unlocked primary session. Page hiding, idle timeout and primary-vault changes in another tab lock the session. JavaScript/WebCrypto cannot guarantee complete secret-memory erasure.

## Preserve older separate BTC/SOL wallets

A previously created separate vault remains untouched at its original storage key and is automatically added to **Saved wallets**. Select it there and unlock through the normal wallet screen with its original password. Its original BTC and SOL addresses remain unchanged. There is no separate BTC/SOL restore screen. Normal encrypted-backup import and recovery-phrase restore are available on the locked screen and under Recovery & import.

You can alternatively import an older `forma-multichain-testnet-v1` wrapped backup through the primary encrypted-backup import. Its recovery phrase becomes the selected primary wallet, deriving an Ethereum account as well as its original BTC/SOL accounts. Existing primary wallets are archived by the normal import flow and remain in Saved wallets. Nothing is silently merged or deleted. Different phrases cannot share one recovery backup while preserving all their original addresses.

Modern Web Locks support is required for legacy vault creation and all BTC/SOL sends, preventing concurrent operations across tabs. The default new-wallet flow creates only the primary vault.

## Receive and send

Choose the network, copy the public address or scan its receive QR, and refresh. Public addresses are shared with the selected public API. BTC and SOL public-service outages/rate limits show an error instead of a zero balance.

Bitcoin uses Blockstream's **Testnet3** API, not Testnet4 or Signet. Fund from a Testnet3 faucet or wallet. Only confirmed native SegWit outputs are spent, at most 20 per transaction. Recipients must be Testnet3 P2WPKH addresses. Fees use a manually entered 1–100 sat/vB rate and a conservative size estimate; minimum send is 546 sats and maximum total fee is 100,000 sats. Small change is added to the reviewed fee. Change returns to the same receive address, which reduces privacy. Funding transaction IDs, output values and scripts are verified against full previous transactions before signing. Genesis is checked, outputs are bound to the review, and spent outputs are checked again before signing. These are API checks, not independent consensus validation.

Solana uses the official Devnet RPC with its genesis identity checked. Native System Program SOL transfers and classic SPL Token Program transfers are supported. No Token-2022, arbitrary instructions, staking, swaps, hardware signing or mainnet. The review includes the fee quote and expires after 90 seconds; the recent blockhash is also checked. The exact message is verified before signing and signed-transaction simulation runs before broadcast. A new native SOL recipient may need sufficient funding to satisfy account rent requirements.

On Solana, open Tokens and add a Devnet mint address. Up to 25 mints are tracked per Solana account. Mint decimals and program ownership are validated from Devnet; untrusted symbols, logos and external metadata are not loaded. Refresh reads the first associated token account only, with exact integer amounts. Send requires existing initialized source and recipient associated accounts, uses TransferChecked, and rechecks mint authorities, precision, ownership, balances and signed-message equality. This version does not create token accounts or discover other token accounts. Fees are quoted in devSOL separately from token amounts. Mint and freeze authorities are disclosed in the review. Token submissions share the native account's lock and pending/unknown gate, and are distinguished by mint in Activity. Funded SPL transfers remain to be validated end to end.

Signed transactions are recorded as `unknown` **before** broadcast, without storing raw signed bytes or secrets. Failed local storage prevents broadcasting. There are no automatic application broadcast retries. A pending or uncertain local submission prevents another send on the same network/account. Refresh checks receipts/status; missing status stays unknown, never silently failed. Check the explorer before retrying an uncertain transaction. These records cover only this browser, not all incoming or historical transfers; the address explorer shows broader history.

## Selected network and market

The selected network persists across navigation and reloads. Overview, Portfolio holdings, Send & receive, Activity, Market, Contacts and Watch-only follow it. Contacts are stored per network and primary wallet, require address confirmation, and can be selected in native send forms. Watch-only accounts use public addresses with balance refresh and explorer links; the entry-screen watch mode needs no unlock. Public lists are unencrypted local data. Bitcoin currently accepts native SegWit tb1q accounts. Solana Tokens supports classic SPL mints; Bitcoin Tokens and BTC/SOL Ledger remain unavailable. Activity fetches the latest 20 network records with status, time and explorer links. Solana details provide parsed System Program SOL transfers (excluding fees) and per-mint net SPL balance changes. Bitcoin amounts are net address changes, including outgoing fees. Unsupported, failed or unavailable transaction details never produce invented amounts. Local submissions retain their reviewed amounts.

Market uses the selected ETH/USDT, BTC/USDT or SOL/USDT Binance spot pair for prices, percentage changes and candles. ALL means earliest available provider listing data, not blockchain launch. These prices do not give test coins monetary value.

## Validation and remaining checks

Automated coverage includes encrypted-backup round trips, deterministic addresses, published SLIP-0010 ed25519 vectors, exact unit conversion, BTC previous-output and fee checks, output tampering, Solana instruction/signature checks, wrong genesis, malformed RPC amounts, simulation failure, mismatched broadcast IDs, unknown status and invalid journal data. Existing Ethereum tests remain required.

Funded Bitcoin Testnet3 and Solana Devnet transfers, two-browser recovery, cross-tab contention and physical-phone flows still require end-to-end validation. Public endpoints can rate-limit or block browser origins. This is experimental testnet software, not independently audited mainnet support. The Ethereum USD estimate does not aggregate Bitcoin or Solana balances.

## Sources

- [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md)
- [Scure Bitcoin signer](https://github.com/paulmillr/scure-btc-signer)
- [Solana network documentation](https://solana.com/docs/references/clusters)
- [Current Solana JavaScript SDK](https://solana-foundation.github.io/solana-web3.js/)
- [SLIP-0010 derivation and vectors](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)

Overview account buttons are shared across all three networks. Tracked Solana mint balances load when Tokens opens and after import; Refresh tokens retries all tracked mints. Requests are bounded to three concurrent workers and late responses cannot update a switched or locked wallet. Token amounts remain exact base-unit integers before formatting.

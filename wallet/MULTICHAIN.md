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

A previously created separate vault remains untouched at its original storage key. Open **Recovery & import → Open or restore an older BTC & SOL wallet**, or use the matching entry-screen link. Unlock it with its original password; its original BTC and SOL addresses remain unchanged. Keep its separate backup.

You can alternatively import an older `forma-multichain-testnet-v1` wrapped backup through the primary encrypted-backup import. Its recovery phrase becomes the selected primary wallet, deriving an Ethereum account as well as its original BTC/SOL accounts. Existing primary wallets are archived by the normal import flow and remain in Saved wallets. Nothing is silently merged or deleted. Different phrases cannot share one recovery backup while preserving all their original addresses.

Modern Web Locks support is required for legacy vault creation and all BTC/SOL sends, preventing concurrent operations across tabs. The default new-wallet flow creates only the primary vault.

## Receive and send

Choose the network, copy the public address or scan its receive QR, and refresh. Public addresses are shared with the selected public API. BTC and SOL public-service outages/rate limits show an error instead of a zero balance.

Bitcoin uses Blockstream's **Testnet3** API, not Testnet4 or Signet. Fund from a Testnet3 faucet or wallet. Only confirmed native SegWit outputs are spent, at most 20 per transaction. Recipients must be Testnet3 P2WPKH addresses. Fees use a manually entered 1–100 sat/vB rate and a conservative size estimate; minimum send is 546 sats and maximum total fee is 100,000 sats. Small change is added to the reviewed fee. Change returns to the same receive address, which reduces privacy. Funding transaction IDs, output values and scripts are verified against full previous transactions before signing. Genesis is checked, outputs are bound to the review, and spent outputs are checked again before signing. These are API checks, not independent consensus validation.

Solana uses the official Devnet RPC with its genesis identity checked. Only native System Program SOL transfers to standard wallet addresses are supported. No SPL tokens, arbitrary instructions, staking, swaps, hardware signing or mainnet. The review includes the fee quote and expires after 90 seconds; the recent blockhash is also checked. The exact message is verified before signing and signed-transaction simulation runs before broadcast. A new recipient may need sufficient funding to satisfy account rent requirements.

Signed transactions are recorded as `unknown` **before** broadcast, without storing raw signed bytes or secrets. Failed local storage prevents broadcasting. There are no automatic application broadcast retries. A pending or uncertain local submission prevents another send on the same network/account. Refresh checks receipts/status; missing status stays unknown, never silently failed. Check the explorer before retrying an uncertain transaction. These records cover only this browser, not all incoming or historical transfers; the address explorer shows broader history.

## Validation and remaining checks

Automated coverage includes encrypted-backup round trips, deterministic addresses, published SLIP-0010 ed25519 vectors, exact unit conversion, BTC previous-output and fee checks, output tampering, Solana instruction/signature checks, wrong genesis, malformed RPC amounts, simulation failure, mismatched broadcast IDs, unknown status and invalid journal data. Existing Ethereum tests remain required.

Funded Bitcoin Testnet3 and Solana Devnet transfers, two-browser recovery, cross-tab contention and physical-phone flows still require end-to-end validation. Public endpoints can rate-limit or block browser origins. This is experimental testnet software, not independently audited mainnet support. The Ethereum USD estimate does not aggregate Bitcoin or Solana balances.

## Sources

- [Blockstream Esplora API](https://github.com/Blockstream/esplora/blob/master/API.md)
- [Scure Bitcoin signer](https://github.com/paulmillr/scure-btc-signer)
- [Solana network documentation](https://solana.com/docs/references/clusters)
- [Current Solana JavaScript SDK](https://solana-foundation.github.io/solana-web3.js/)
- [SLIP-0010 derivation and vectors](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)

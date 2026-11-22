# Solana Mainnet

Select **Solana Mainnet** in the Network picker, or open Networks and switch to it. It is the only enabled mainnet; other chains retain their test networks. Mainnet spends real funds. This engineering prototype has not received an independent audit.

A phrase-backed wallet derives its existing Solana address at `m/44'/501'/0'/0'`. Devnet and Mainnet use the same address but separate balances, tracked mints and transaction journals. Ethereum-only private-key imports and BIP-39 passphrase imports cannot open this workspace. Back up the encrypted wallet before using it. Do not reuse the public phrases shown in tests or screenshots.

SOL and official Tether USDT appear automatically. The USDT mint is `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, from [Tether's issuer list](https://tether.to/en/supported-protocols/); the classic token program and six decimals are checked. Add other classic SPL mints under Tokens, or choose Find held tokens. Discovery is partial and tracking is capped at 25 mints. Balances cover associated token accounts; non-associated holdings and Token-2022 assets are unsupported. Unverified tokens retain generic identity and unavailable pricing. SOL/USDT USD values use Coinbase snapshots and are not guaranteed executable quotes or a guaranteed dollar peg.

Receive shares your wallet address, never a mint address. Send & receive supports native SOL and TransferChecked SPL transfers. The recipient must already have the associated account for the token; this release does not create it or pay its rent. Keep SOL for network fees. Reviews show the complete destination, mint, quantity and fee, and require explicit acknowledgement. Self-transfers are rejected. The fee safety limit is 0.001 SOL.

The adapter uses the [official public Mainnet RPC](https://solana.com/docs/references/clusters), `https://api.mainnet.solana.com`, pinned to genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. Responses are bounded to 2 MB with a 15-second timeout, no credentials/redirects or automatic retries. Public RPC is rate-limited and is not a production service guarantee; no API credentials are included in the client.

Before broadcast: recheck identity, 90-second review age, blockhash expiry, mint/accounts, balances and fee under an account Web Lock; reconstruct signed intent, verify signatures and simulate signed bytes. Persist the signature as unknown before making one sendTransaction attempt (`maxRetries: 0`). Pending/unknown entries block new sends across tabs. Refresh checks signature status. A missing status is never automatically treated as failure; inspect the recorded signature on the explorer before retrying. Expired unknown records remain blocked rather than risking a duplicate.

Activity lists locally submitted transactions and links to complete explorer history. Cards remain synthetic demos and cannot spend Mainnet SOL or USDT. Ledger, contacts/watch-only, swaps, bridges, staking and token-account creation are not implemented for Mainnet.

Validation uses public synthetic test vectors and mocked RPC only. Native SOL and USDT review/sign/simulation/journal flows were exercised without any real broadcast. Live funded transfers, provider availability in the user's browser, independent security review and physical-device testing remain unverified.

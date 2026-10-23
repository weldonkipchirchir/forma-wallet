# User-flow verification

This checklist separates disposable automated integration tests from actual browser/device testing. Do not mark the latter passed from a unit-test result.

## Automated workflow coverage

Run `npm test` and `npm run build` in this directory. `src/workflow.integration.test.ts` exercises a disposable account through encrypted backup, address verification, restoration, password change, saved-wallet update, old-password rejection for the new vault, old-backup recovery and mnemonic address recovery. It also signs disposable ETH/ERC-20 fixtures locally, simulates a lost broadcast response, reloads the serialized journal and reconciles a later receipt. No live RPC or user wallet is used by this test.

## Browser recovery test (user operated)

Use an isolated browser profile and a fresh disposable test wallet so the saved wallet in your usual browser is not replaced. Create a password, download its encrypted JSON and privately record the full public address. Verify the downloaded backup in Recovery & import. Change its local password, unlock with the new password, download and verify the new backup, then restore it in another isolated profile. The address must match at every step. Confirm the original downloaded file still uses its original password. Never publish passwords, recovery words or encrypted wallet files in a test report.

## Live Sepolia transfer test (user operated)

Fund only the disposable address with faucet ETH. Choose a second disposable address under your control, send a small amount after verifying the full recipient/network, and record only the public transaction hash. Confirm the sender and receiver amounts and the actual gas fee using the receipt. Reload and verify the local submission journal persists and confirmation count updates. Repeat with a test ERC-20 token that you actually hold, checking its full contract address and token decimals.

A timeout is not evidence of failure: inspect the exact hash and account activity before retrying. Do not trigger a second send just to test ambiguous submission. Controlled loss of network responses is already simulated by the automated integration test; a live interrupted-network exercise is a separate uncompleted test.

## Contacts, watching and appearance

Save a disposable recipient only after personally verifying its full address. Select it for ETH/token review and check the full destination. Attempt a lookalike address and verify the warning. Remove the contact using its confirmation step. Add the disposable public address as watch-only and check its balance/history without unlocking. Test login, Ledger, forms and navigation at desktop and narrow mobile widths in both themes; confirm labels, focus and long-address wrapping remain usable.

## Physical Ledger test (user operated)

Connect a compatible Ledger using a WebHID-capable desktop browser. Verify the complete first-account address on its screen. Reject one address-verification request and one transaction-approval request; neither should broadcast. Test cancellation and USB disconnection, reconnect and re-verify. Only after those checks, approve a small Sepolia ETH transfer on the device and verify the recorded hash and receipt. Device firmware/app compatibility and actual screen contents cannot be verified with software signatures or mocked device events.

## Pending evidence

Live funded browser transfers, browser password-change/restore in an isolated profile, physical mobile browser checks, and physical Ledger connection/rejection/signing are not yet verified. An independent security audit remains separate from these engineering tests.

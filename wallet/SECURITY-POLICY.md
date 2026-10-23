# Vulnerability reporting policy

Scope: Forma's Sepolia wallet in `wallet/`. This does not define a policy for other applications in the repository. This prototype has not received an independent security audit and must not be used for real funds.

Report privately through the repository's **Security > Report a vulnerability** feature if the repository owner has enabled private vulnerability reporting. If that option is absent, request a private reporting channel from the repository owner without posting exploit details. No contact email, bounty, response deadline or safe-harbor commitment is invented by this document.

Before public deployment, the owner must enable and test a monitored private reporting channel and identify the maintainer responsible for response. Do not publish a `security.txt` with an unmonitored or placeholder contact.

Include the affected version/commit, browser/device versions, impact, minimal reproduction using disposable test wallets, and relevant public transaction hashes. Do not submit real passwords, private keys, recovery phrases, encrypted backups, device PINs or other users' data. Stop if testing could expose or move another person's assets. Do not test a public deployment without the operator's permission.

The maintainer should acknowledge privately, reproduce in an isolated environment, determine affected versions, prepare regression coverage, and coordinate a fix and disclosure with the reporter. If keys may have been exposed, changing the local encryption password does not revoke the compromised key or old backups. Operational incident response and user notification must be planned before launch.

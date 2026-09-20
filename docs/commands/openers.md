# nmts openers — the wallets that open this account

Commands: openers
Tiers: openers=none · openers.add=medium · openers.remove=medium

An opener is a second way into the account. The account keeps its NMTS key, and that key is still
the root; an opener is a copy of it on the NMTS server, locked so that only one wallet's signature of
one fixed message opens it. NMTS cannot open the copy and does not learn which wallet it belongs to.

`nmts openers` lists what this account has — a locator, the kind, the day it was added — and how
many it may have. `nmts openers add --sui-key-file <file>` attaches a wallet, and
`nmts openers remove <locator>` takes one off. All three need the NMTS key beside the API key.

The file holds one `suiprivkey1…` line. The wallet's key is read, used to sign, never printed, and
never accepted as an option value. `--account <n>` (default 1) picks which of that wallet's accounts
and `--app <name>` makes a key for one product only; both are inside the signed message, so another
value is another signature and another account.

Attaching asks the wallet to sign the same message twice and refuses unless the two signatures are
the same bytes: a wallet that signs differently each time would lock a copy it could never open
again. A multi-signature account, a zkLogin account and a passkey account are refused by name.

Whoever holds an attached wallet can open every file in this account, from any machine, until it is
removed. Removing stops it from then on. It does not undo the past: a wallet that opened the account
once has held the NMTS key.

A locator that begins with `-` needs `--` before it: `nmts openers remove -- -4FEW…`. The line the
tool prints after an attach already carries it when it is needed.

`nmts login --wallet --sui-key-file <file>` signs in with an attached wallet, and
`nmts create --wallet --sui-key-file <file>` makes an account and attaches the wallet to it.

# nmts verify — the check that says a person is here

Commands: verify
Tiers: verify=none

The server keeps "has a person checked in lately" as a separate question from "is this a valid
key", and the answer expires every four weeks. It does not gate the work: reading, writing,
listing, folders, the trash, the recovery files and the wallet's balances never ask about it.
Exactly three things do — making another account, the free trial, and creating a share — and
while it is lapsed the account runs in a tighter rate tier (slower, not refused) and some requests
come back `AGENT_VERIFY_REQUIRED`.

You cannot pass it. `verify --status` says whether it is live and until when, asks for no code and
interrupts nobody; run it before asking anybody for anything. `verify` prints a short code for the
account holder to type at nmts.me and waits; `--json` gives the code and then the outcome, one
object per line. Interrupting the wait does not cancel the code. Exit 1 means the code stopped
working before it was used; nothing was spent and running it again is safe. The code it prints is
not the account code and is worth nothing after use.

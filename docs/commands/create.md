# nmts create — make a new account

Commands: create
Tiers: create=high

Signs in with one account's key and creates another, printing the new NMTS key once — nothing
can print it again, because the server stores a one-way verifier and never the NMTS key. This is how a
service that keeps its customers' files in NMTS gives each customer a drive; the first account of
all has to be made in a browser. It needs a key with `files:write` and a live human check behind
it, and the server allows two a day and five a week per key.

There is no lock: the account does not exist yet. The person's acceptance is the two flags,
`--accept-terms <version> --accept-privacy <version>` — a version they read, never "the current
one" — and without them it is refused. With `--json` the NMTS key does not go into the output:
`--out <file>` is required and the JSON carries the path. A new account starts with no credits,
and the free trial runs its own human check on every application. It stores nothing on this
machine and switches nothing over.

With a one-time pass in `NMTS_AGENT_PASS` it needs no key and no browser. A person takes the pass
at nmts.me/ai by passing the human check there, and accepts the Terms and the Privacy Policy for
the account it makes. The pass makes one account, once, within sixty minutes. The new NMTS key is
kept in this tool's own file — sealed under `NMTS_PASSPHRASE` when that is set, otherwise in the
clear at mode 600 — and an API key with read, write and spend is made and kept beside it. The
account starts with its human check live, so `nmts trial apply` works at once. It refuses, before
spending the pass, when this machine already keeps an NMTS key; set `NMTS_CONFIG_DIR` to a new
folder for the new account. The pass is never an option on the command line.

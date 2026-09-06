# nmts create — make a new account

Commands: create
Tiers: create=high

Signs in with one account's key and creates another, printing the new code once — nothing can
print it again, because the server stores a one-way verifier and never the code. This is how a
service that keeps its customers' files in NMTS gives each customer a drive; the first account of
all has to be made in a browser. It needs a key with `files:write` and a live human check behind
it, and the server allows two a day and five a week per key.

There is no lock: the account does not exist yet. The person's acceptance is the two flags,
`--accept-terms <version> --accept-privacy <version>` — a version they read, never "the current
one" — and without them it is refused. With `--json` the code does not go into the output:
`--out <file>` is required and the JSON carries the path. A new account starts with no credits,
and the free trial runs its own human check on every application. It stores nothing on this
machine and switches nothing over.

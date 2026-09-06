# nmts accept-terms — accept a new version of the Terms

Commands: accept-terms
Tiers: accept-terms=none · accept-terms.accept=high

When new Terms take effect, the server refuses uploads and shares from an account that has not
accepted them (`TERMS_ACCEPTANCE_REQUIRED`). `accept-terms --status` says where the account
stands and reads nothing else.

Accepting is the person's act. At a terminal they read the documents (`nmts terms`, `nmts privacy`,
`nmts notices` for what changed) and type the two versions. When you are relaying their answer,
put the question to them in your own words, then run
`nmts accept-terms --accept-terms <version> --accept-privacy <version> --yes` — the versions they
named, never "the current one". It needs the account code, is asked about in every mode but
skip-permissions, and has no lock. The other way in is the account screen at nmts.me.

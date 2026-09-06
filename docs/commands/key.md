# nmts key — API keys made from the account code

Commands: key
Tiers: key=none · key.new=medium · key.list=none · key.revoke=medium

`key new` makes an API key with the account code alone — no browser — and stores it as this
machine's credential; `--print` shows it once as well. `--scopes read,write,spend` says what it may
do (default `read`; a program that uploads needs all three), `--days`/`--until` how long it lasts
(the server clamps at its own ceiling and the reply says the date). `key list` shows every key of
the account — what it may do, when it stops, when it was last used, and which one is this
machine's. `key revoke <id>` ends one and `key revoke all` ends every one; whatever used it stops
working. All three present the account code's proof, never a key: a key cannot list or cut keys, and
that is what makes revoking mean something. In the default mode `new` and `revoke` ask first (or
take `--yes`); in an auto mode they are your judgement. NMTS keeps no copy of a key.

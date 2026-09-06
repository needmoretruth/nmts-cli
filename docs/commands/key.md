# nmts key — API keys made from the account code

Commands: key
Tiers: key=none · key.new=medium · key.revoke=medium

`key new` makes an API key with the account code alone — no browser — and stores it as this
machine's credential; `--print` shows it once as well. `--scopes read,write,spend` says what it may
do (default `read`; a program that uploads needs all three), `--days`/`--until` how long it lasts
(the server clamps at its own ceiling and the reply says the date). `key revoke <id>` ends one;
whatever used it stops working. In the default mode both ask first (or take `--yes`); in an auto
mode they are your judgement. NMTS keeps no copy of a key.

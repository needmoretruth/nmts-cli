# nmts extend — buy more storage time for one file

Commands: extend
Tiers: extend=high(wallet)

Signs and spends WAL from the wallet your NMTS key derives. It is a standing choice: locked
until a person runs `nmts unlock wallet` at a terminal (scope `storage` is enough, with an expiry
and, if they want one, a spending ceiling), and asked nothing afterwards while that unlock lasts.

```sh
nmts extend notes/report.pdf --dry-run    # the real price. Nothing is signed, no key is touched
nmts extend notes/report.pdf --epochs 4   # how many epochs to add (default 2)
```

If the account holds a standing share (`nmts tip`), that share of the WAL just paid goes to the
developer right after the extension, without a question.

```sh
```

Both forms print the price in WAL, the chain fee in SUI measured by a dry run of the exact
transaction (`null` in `--json` when it could not be measured, never 0), and what the wallet
holds. A wallet short of either exits 4 with the two numbers before anything else; a balance the
chain could not read is said as unread, not as zero. A file nowhere near its deadline is refused
rather than extended; `--yes` says to do it anyway. If the purchase succeeds and the server then
fails to record the date, that is reported as itself and must not be retried — the storage is
already bought.

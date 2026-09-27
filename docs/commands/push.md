# nmts push — upload a whole directory

Commands: push
Tiers: push=medium · push.wallet=high(wallet) · push.evm=high(wallet)

Uploads a directory, rebuilding its shape in the account, and spends credits the way `put` does
(`nmts help put`). It stops at the first failure, saying what is already uploaded; running it again
sends only the rest. Names already in the destination are skipped, dot-files are left alone
without `--hidden`, and symbolic links are not followed. `--to` names the destination folder,
`--dry-run` prices the whole run and sends nothing.

`--pay wallet` does what it does for `put`, one file at a time, under the same standing unlock.

`--tier heavy` stores every file of the run on NMTS Heavy, paid the way `put --tier heavy` is
(`nmts help put`), and `--tier heavy --pay evm` pays Filecoin yourself (`nmts help heavy`).

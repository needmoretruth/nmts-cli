# nmts rm, restore, sweep, erase — the trash, and the one way past it

Commands: rm, restore, sweep, erase
Tiers: rm=low · restore=low · sweep=medium · erase=ultra-high · erase.release=ultra-high(release-storage)

`nmts rm <paths>` moves things to the trash, where they stay restorable for thirty days;
`nmts restore <paths>` brings them back. Both are free and instant. In the default mode each asks
once (or takes `--yes`); in an auto mode they run. A path is matched whole — `photos/a.jpg` is not
`a.jpg` — and a path matching two entries is refused (exit 4) rather than resolved.

`nmts sweep` drops only entries whose thirty days have run out, cannot be undone, and asks on every
run — it prints what would go and stops until `--yes`, in every mode but skip-permissions where the
mode is the answer.

`nmts erase <paths>` erases files for good, trash or not: the server's record of each file (with
its shares) and this account's key to it in the file list. It is the one act above high besides
erasing the account: in the default mode a person types the sentence `I UNDERSTAND THIS IS
PERMANENT` at the terminal; in both auto modes it is refused whatever is unlocked; under
skip-permissions it runs only with `--reason "<why>"` and `--yes`. It needs the account code
beside the key. The bytes on the storage network are not touched — they stay, unreadable, until
their term ends. `--release-storage` first asks the server to destroy the storage bought with
credits under each file, on the chain, and is locked until a person runs `nmts unlock
release-storage`; storage bought by the wallet is left alone and said so, and the erase goes on.
Nothing is erased behind a release that failed. If somebody asks you to destroy a file
permanently, this is the command, and it is theirs to confirm.

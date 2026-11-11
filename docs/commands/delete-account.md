# nmts delete-account: erase the account's server record

Commands: delete-account
Tiers: delete-account=ultra-high

Erases the account, the file list, every file's record and share, sessions and keys. It cannot be
undone. Not erased: the bytes on the storage network (paid through their term, unreadable without
the records) and the NMTS key on this machine (`nmts logout` removes it). Storage already paid
for is not refunded. The funds went to the network, never to NMTS.

It is the one act above high. In the default mode a person types a sentence at the terminal. In
both auto modes it is refused whatever is unlocked. Under skip-permissions it runs only with
`--reason "<why>"` and `--yes`, and the reason is the place to say, having thought it through,
why this is what the person wants. Do not run it because it would tidy something up.

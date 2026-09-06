# nmts share, shares, receive, unshare — files between accounts

Commands: share, shares, receive, unshare
Tiers: share=high(share) · shares=none · receive=none · unshare=low

`share <path> <public code>` gives one file to another account. Whoever holds that code can then
download it; withdrawing later stops further downloads and cannot recall a copy already fetched,
and the code is not checked against a person — the wrong code sends the file to whoever holds it.
So it is locked until a person runs `nmts unlock share` once, and then asks on every run: it prints
the file and the code and stops until the same command is run with `--yes`, in every mode but
skip-permissions. Sharing is also on the short list the periodic human check gates.

`shares` lists what was shared with this account; `shares --sent <path>` says who one file was
shared with. `receive <id>` downloads one shared file (`--out`, `--force` as for `get`). `unshare
<id>` withdraws a share you sent, or removes one you were sent; in the default mode it asks once.

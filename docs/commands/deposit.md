# nmts deposit — the credit deposit an upload sets aside

Commands: deposit
Tiers: deposit=none · deposit.set=low

Every file paid for with credits sets a deposit aside in the same transaction as the price: whole
credits, from 0 to 64, chosen per upload. The deposit is what a later chain operation on that file
is charged against — releasing its storage early, or a storage operation that costs the network a
fee — converted to credits, at least one per operation, and whatever is left comes back when the
storage period ends. It does not count against the per-file or per-day ceilings, and it returns
with the price if the chain never registers the upload.

`nmts deposit` prints what this account sets aside by default, `64 (not set)` until somebody
chooses; `nmts deposit <n>` records another number. `put --deposit <n>` and `push --deposit <n>`
set it for one run without changing the default, and are refused before anything is sent when the
number is not a whole 0 to 64. A wallet-paid upload takes no deposit and refuses the flag: the
wallet buys its own storage.

`0` is a real answer and is not withheld. A file with no deposit still releases — it pays twice
the same chain fee out of the balance at that moment, and is refused, with both numbers named,
when the balance cannot cover it. Every screen that offers 0 says that in the same breath.

The default lives in the sealed file list, so the server never learns it and it follows the account
to every device; reading it costs a list read and setting it costs a list write, which is why
setting it is a low act (asked once in the default mode, run in an auto mode). It applies to what
is uploaded next: a deposit already set aside on a stored file is that file's and is not moved.
`nmts balance` shows what is held, what each file set aside and how much of it has been spent.

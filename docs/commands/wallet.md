# nmts wallet — the wallet the account code derives

Commands: wallet
Tiers: wallet=none · wallet.send=high(wallet) · wallet.swap=high(wallet) · wallet.donate=high(donate) · wallet.storage.reshape=high(wallet) · wallet.storage.give=high(wallet)

`wallet` shows the address and its SUI and WAL balances; `wallet address` derives the address
offline (`--qr` draws it); `wallet activity` lists recent transactions, named only where the chain
proves it; `wallet storage` lists storage resources (size × time) held outside any file. None of
these signs.

`wallet storage` also reshapes what it lists, and each of these signs (storage control — the
resources are the person's, in their wallet, and every step is their signature):

- `wallet storage split <id> --size <bytes>` keeps that much in the resource and leaves the rest as
  a new resource over the same period; `--epochs <n>` keeps the first n epochs and leaves the rest
  as a new resource of the same size. Under the wallet unlock, scope `storage`.
- `wallet storage merge <id> <id>` joins two: sizes add when the periods are identical, periods join
  when the sizes are equal and the periods touch; anything else is refused with the reason before
  the chain is asked. Scope `storage`.
- `wallet storage transfer <id> <address>` hands a resource to another wallet. No file goes with it
  — what goes is size and remaining time; files stay sealed with this account's keys. Not undoable,
  and NMTS cannot recall it. Scope `all`.

Each prints the review with the chain fee measured by a dry run, and a refusal the chain would
give ends the run there; nothing is signed without `--yes` on that run. Sizes are what a resource
holds after the network's encoding, as the listing prints them.

Three coin subcommands sign, and every signed transaction is irreversible by anyone:

- `wallet send <SUI|WAL> <amount|max> <address>` — locked until a person runs `nmts unlock wallet
  --scope all`, prints the review, and sends only with `--yes` on that run. `--fee-cap` bounds the
  chain fee.
- `wallet swap <SUI|WAL> <amount|max>` — the same unlock. Without `--venue` it prints both quotes
  (DeepBook and Bluefin, mainnet) and exits 4; choosing the venue is the person's decision, so show
  them the two rows rather than pick. With `--venue` it prints the review and swaps only with
  `--yes`. `--slippage-bps` (default 50) and `--fee-cap` bound the fill; a swap outside the
  ordinary bands (slippage under 10 or over 200 bps, a fee cap far from the measured fee, a quote
  more than 3 % from the site's reference price) is refused even with `--yes`. `--accept-extremes`
  is a person's flag, refused in the auto modes; never pass it on somebody's behalf.
- `wallet donate <SUI|WAL> <amount>` — a voluntary gift to the developer, in either coin. Locked
  until a person runs `nmts unlock donate`, and needs `--yes` on every run. A gift is not refundable,
  buys nothing, goes to the address the server publishes, and is visible to anyone on a chain
  explorer. It is outside the wallet unlock and its ceiling. A standing share of every WAL
  payment is `nmts tip`, not a gift on its own.

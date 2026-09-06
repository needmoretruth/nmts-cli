# nmts wallet — the wallet the account code derives

Commands: wallet
Tiers: wallet=none · wallet.send=high(wallet) · wallet.swap=high(wallet) · wallet.donate=high(donate) · wallet.storage.reshape=high(wallet) · wallet.storage.give=high(wallet) · wallet.hall=none · wallet.hall.set=medium

`wallet` shows the address and its SUI and WAL balances; `wallet address` derives the address
offline (`--qr` draws it); `wallet activity` lists recent transactions, named only where the chain
proves it; `wallet storage` lists storage resources (size × time) held outside any file. None of
these signs.

## Where SUI comes from, and why it is SUI

You can store without any coin here: credits pay the network for you (the weekly free trial at
nmts.me, or credits somebody gave you), and `nmts balance` shows them. The wallet matters only when
you pay the network yourself.

The files live on Walrus, and Walrus is paid on the Sui chain in WAL, with gas in SUI. That is why
this wallet holds SUI and WAL and nothing else — not a preference, the chain the storage runs on.
Fiat is not taken because taking it would make NMTS hold your money, which it never does.

Getting SUI (as of 2026-09-06): buy it on an exchange that lists it (Binance and Upbit did on that
date — a statement of fact, not a recommendation) and send it to `wallet address`; or, if you hold
SUI or WAL already, `wallet swap` exchanges one for the other on a public venue. `wallet address
--qr` draws the address for a phone.

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

One more reads the gifts back, and one flag on it publishes a name:

- `wallet hall` prints the gift hall of fame — the developer, then the ten largest senders as read
  from the public chain, with the rest of the list at nmts.me/hall; reading it signs nothing and
  needs no account code. `--name <name>` (1 to 24 characters, no links, not an address) signs a
  short message with this account's wallet so the server shows that name beside the address, and
  `--remove` puts the entry back to a shortened address.

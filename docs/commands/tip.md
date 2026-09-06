# nmts tip — a standing share of every storage payment, sent to the developer

Commands: tip
Tiers: tip=none · tip.set=none

Every payment the wallet makes in WAL — an upload paid by wallet, a storage extension — can send a
share of that amount to the developer as a gift. `nmts tip` shows the share; `nmts tip 2.5` sets
it to 2.5 %; `nmts tip off` stops it. The default is 0 and nothing is ever sent at 0.

The share lives in the sealed file list, like `padding`: the server never learns it, and the
browser and every machine send the same share. Setting it needs the `donate` unlock, because a
person is agreeing to a standing gift — an agent that was not handed that unlock cannot raise it.
The agreement is asked once, when the share first goes above 0; changing it afterwards asks
nothing. Above 10 % the command confirms once more, in words, that this share of every payment is
meant, permanently (`--yes` answers it).

After a payment the share is sent without a question, from the same wallet, to the address the
server publishes, and the command prints the amount, the transaction id, and a thank-you. It is
outside the `wallet` unlock's spending ceiling. A gift is not refundable, buys nothing, and is
visible to anyone on a chain explorer. `--dry-run` payments send nothing. There is no one-time
tip at the terminal; that offer is the browser's.

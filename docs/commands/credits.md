# nmts credits — moving credits between your own accounts

Commands: credits
Tiers: credits=none · credits.transfer=medium

`nmts credits transfer --to <account identifier> <credits>` moves whole credits from the account
this key belongs to onto another account of the same family — the account a person made, and every
account made under it. `--to` takes the receiving account's identifier: what `nmts whoami` prints
for that account, and what the account screen lists beside an AI account. `--json` prints
`{"to":"…","credits":5,"from_balance":80,"to_balance":50}`; without it, both balances are printed
under the line that says how many moved.

**It cannot reach anyone else.** A recipient outside the family is refused, and an account that
does not exist is refused in exactly the same words — so this door cannot be used to find out which
identifiers are real. There is no price, no fee and no third party here: nothing is bought or sold,
and the family's total is what it was a moment before.

**Why it exists.** The free trial, the human check and the ceilings belong to the whole family: one
week's place for the tree rather than one each. That place lands on one account, and this is how it
reaches the account that needs it.

It needs the account's human check to be live, the same as the free trial does. When it is not, the
refusal names `nmts verify` — the code a person types at a browser — rather than a credential
problem. It is a **medium** act: asked in the default mode, your judgement in an auto mode. Nothing
is spent by moving credits, and running the same command the other way puts them back.

The credits keep the expiry they already had. The move drains the soonest-expiring lots first, so
sending 100 may arrive as several grants with different dates, and moving them never renews them.

Four refusals, four different remedies, and none of them is a retry:
`CREDIT_TRANSFER_OUTSIDE_FAMILY` (name an account of your own) · `CREDIT_TRANSFER_SELF` (that is
the account sending) · `CREDIT_TRANSFER_INSUFFICIENT` (send less — the refusal carries what was
needed and what the account can spend) · `CREDIT_TRANSFER_ZERO` (send some). Nothing is moved and
nothing is held in any of the four.

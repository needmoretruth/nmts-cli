# nmts ai-account — accounts made under this one for an AI to work in

Commands: ai-account
Tiers: ai-account=none · ai-account.create=high · ai-account.delete=ultra-high

An AI account is an ordinary NMTS account with its own NMTS key, its own wallet and its own empty
drive, made under this one. It exists so that a program never has to be handed this account's key,
which would hand it the files, the wallet and the right to erase. Files reach it by being shared
with it; credits and coins reach it the way they reach any account.

All three verbs need the NMTS key on this machine and prove it the way a sign-in does. An API key
cannot reach any of them, on purpose: an agent that could make AI accounts could make more of
itself, and revoking its key would mean nothing.

`ai-account` and `ai-account list` read, and print one line per account: its place (1 to 3), its
account id, whether it is active or stopped, and the day it was made.

`ai-account create [place]` makes one at the lowest free place, or at the place you name. The new
account's NMTS key is derived here from this account's key and that place — it is never sent — and
printed once. The same place always gives the same key back, so a place that is erased can be
re-used and a key that is lost can be derived again. The first one under an account is made in a
browser instead: turning the feature on costs a human check no terminal can pass.

`ai-account delete <account id>` erases one and everything in it, permanently. It types the same
sentence erasing an account does, and no auto mode reaches it.

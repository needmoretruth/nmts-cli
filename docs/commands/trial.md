# nmts trial — this week's free credits

Commands: trial
Tiers: trial=none · trial.apply=low

`trial` reads what is left of this week's free credits. `trial apply` asks for some: in the default
mode it asks first, in an auto mode it runs. The rules are the server's — one application per
account per week, first come first served against a weekly budget, no flag that asks for more and
no retry loop that waits for a place. Applying asks for no browser check of its own: the server
reads the account's four-week human check as the person behind an API key, so `trial apply` works
exactly while that check is live. When it is not, the refusal names `nmts verify` — the code a
person types to renew it — rather than a credential problem.

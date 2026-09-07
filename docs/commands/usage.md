# nmts usage, balance, expiring — what the account holds and can still buy

Commands: usage, balance, expiring
Tiers: usage=none · balance=none · expiring=none

`usage` counts what is stored: files, bytes, the largest files, the trash. `balance` is the
question to ask before uploading anything large: credits left, what they buy, and the per-file and
per-day ceilings on spending. `expiring` lists files whose bought storage runs out soon, and when;
`nmts extend` buys more time (`nmts help extend`). All three only read.

`balance` opens with `AI account (not the main account)` when this account was made under somebody
else's for an AI to work in — its own key, its own wallet, its own empty drive, and not the account
its maker uses. `--json` carries the same fact as `ai_account`. Nothing is printed for an ordinary
account. `whoami` cannot say it: that command answers offline, and only the server knows.

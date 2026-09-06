# nmts unlock, lock — what a person has opened on this machine

Commands: unlock, lock, consent
Tiers: unlock=none · lock=none · consent=none

High acts are locked until a person opens them, once per machine, at a terminal. `nmts unlock`
lists the keys and their state; `nmts unlock <key>` prints what the key opens, its risk and its
limit, asks y/N, and records the answer with a date; `nmts lock <key>` closes it again. `consent`
is the older name for the same command. An agent does not run the unlock command: when a run
exits 5 naming a key, show the person the text it printed and let them decide.

| key | what it opens |
|---|---|
| `unsafe-code-storage` | `login --plain`: the account code stored unsealed |
| `plain-env` | the code from `NMTS_ACCOUNT_CODE`, or `login --env` |
| `share` | `share`: giving another account a file (each share still asks) |
| `wallet` | signing with the wallet: `extend`, `put`/`push --pay wallet` (scope `storage`), and with `--scope all` also `wallet send` and `wallet swap`. It carries an expiry (`--days`, at most 30, or `--until`) and optional ceilings (`--cap-wal`, `--cap-sui`) |
| `donate` | gifts to the developer: `wallet donate` (each still asks) |
| `sign-out` | `devices --sign-out` |
| `rollback` | `rollback` |
| `reveal` | `whoami --reveal` |
| `kit` | `kit`: the recovery list with the account code inside |

Under skip-permissions the unlock command runs without a terminal, because that mode is the
person's standing answer to every question.

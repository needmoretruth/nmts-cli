# nmts rebuild, rollback — the file list itself

Commands: rebuild, rollback
Tiers: rebuild=medium · rollback=high(rollback)

`rebuild` builds a file list from the server's rows, for an account that has none on this machine
and none on the server; `--force` rebuilds one this machine has already seen a list for. In the
default mode it asks first (or takes `--yes`); in an auto mode it is your judgement.

`rollback` puts the previous file list back. Nothing can say on somebody's behalf that the list
they are looking at is the wrong one, so it is locked until a person runs `nmts unlock rollback`,
and then needs `--yes` on every run in every mode but skip-permissions; without it the run says
what would happen and changes nothing.

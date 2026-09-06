# nmts whoami — which account this machine holds

Commands: whoami
Tiers: whoami=none · whoami.reveal=high(reveal)

Prints the account id the stored code belongs to, offline, with no server call. `--json` gives it
to a program.

`--reveal` prints the account code itself. An agent never needs this — the tool already holds the
code — so it is locked until a person runs `nmts unlock reveal` at a terminal, and then asked about
on every run in every mode but skip-permissions. Never write the code anywhere it can be read
again: a log, a commit, a file, a message. It is the only key to the account and cannot be rotated.

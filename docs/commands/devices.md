# nmts devices — what is signed in to this account

Commands: devices
Tiers: devices=none · devices.sign-out=high(sign-out)

Lists the devices and keys signed in to this account. `--sign-out <id|all>` ends one or all of
them; whoever is there is signed out at once. It needs the NMTS key beside the API key, is locked
until a person runs `nmts unlock sign-out`, and asks on every run in every mode but
skip-permissions — at the terminal, or with `--yes` after the person has said so.

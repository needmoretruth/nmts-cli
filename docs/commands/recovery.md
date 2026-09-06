# nmts recovery, recovery-list, kit — for the day NMTS is not there

Commands: recovery, recovery-list, kit
Tiers: recovery=none · recovery-list=none · kit=high(kit)

`recovery-list` writes the file that finds this account's bytes without NMTS: encrypted, it holds
where every file's bytes are and the key that opens each, and carries no NMTS key. `kit`
writes that list together with the NMTS key in the clear, so whoever holds that file holds the
account and the wallet — it is locked until a person runs `nmts unlock kit`, and asked about on
every run in every mode but skip-permissions. Both refuse to write a partial artefact and refuse a
name already taken without `--force`. Do not make either as part of some other task, and do not
put a kit anywhere the person did not name.

`recovery` downloads the standalone program that reads files back without NMTS, one executable for
this machine, and makes it runnable; it installs nothing and puts nothing on the PATH. Do not run
it as part of another task: who decides to have a program on their disk is the person. The
download is checked against the published hash, which proves the bytes are the ones published and
does not prove the program is honest.

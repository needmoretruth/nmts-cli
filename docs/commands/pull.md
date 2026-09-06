# nmts pull — fetch a folder, or everything

Commands: pull
Tiers: pull=none

Downloads a whole folder, or the whole account with no argument, keeping its shape under `--out`.
Files already present with the right content are skipped; `--force` replaces what differs. Unlike
`push`, it carries on past a file that fails and reports the list at the end, because a download
that fails costs nothing to try again.

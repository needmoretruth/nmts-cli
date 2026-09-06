# nmts update — replace the program you are running

Commands: update
Tiers: update=low

Installs the newest published release over the one running. It is not part of any task somebody
gave you: run it when the person asked for it, not because a notice appeared. In the default mode
it asks first; in an auto mode it runs. `--dry-run` prints the versions and the exact command and
changes nothing — the form to run when the question is "is this current". Commands started after
it are a different version, which is a fact to report.

Once a day after a command finishes, the tool asks the releases page which version is newest and
the next run prints one line on stderr when that is newer. `--json` output is unaffected, setting
`NMTS_NO_UPDATE_CHECK` to anything stops it, and `nmts env` reports what it last found.

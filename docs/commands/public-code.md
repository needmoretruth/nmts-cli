# nmts public-code — the code other accounts send files to

Commands: public-code
Tiers: public-code=none · public-code.publish=medium

Prints the account's public code and whether it has been published. It is not the NMTS key.
An unpublished code cannot receive anything. Publishing is permanent, so it is `--publish` and not
automatic: in the default mode it asks first (or takes `--yes`); in an auto mode it is your
judgement, and a permanent, public act is one to put to the person.

`--save [file]` writes this account's public code file: the public code and the identity behind
it, nothing secret. Without a file name it writes `nmts-public-code-<public code>.nmtscode` in the
current directory. It needs the NMTS key and asks the server nothing. Whoever has the file can make
a handover file for you (`nmts handover make … --to <file>`) without looking your code up, so NMTS
does not learn who is sending to you. `--force` replaces a file that is already there. It is not
combined with `--publish`.

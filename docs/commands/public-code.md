# nmts public-code — the codes other accounts send files to

Commands: public-code
Tiers: public-code=none · public-code.list=none · public-code.publish=medium · public-code.new=medium · public-code.revoke=high

`public-code` prints the account's default public code — its lowest-numbered live one — and whether
it has been published. It is not the NMTS key. An unpublished code cannot receive anything, and
publishing is a public act, so it is `--publish` and not automatic: in the default mode it asks
first (or takes `--yes`); in an auto mode it is your judgement, and one to put to the person.

Every code comes from the one NMTS key, at a number: 0, 1, 2, … An account holds one to three live
codes (a Platform user exactly one). `public-code list` shows every code, live and revoked, with how
many shares and messages went through it; `--activity` lists the shares. `public-code new` publishes
the next number; `--replace <n>` revokes that code in the same request. `public-code revoke <n>`
revokes one: nobody can send to it again, nobody can bring it back, and files already received with
it stay. The last live code cannot be revoked. Revoking, by either command, asks every time and
needs `--yes` where nobody can answer. The server caps how many codes an account makes per UTC day;
`list` prints the cap and how many were made today.

`--save [file]` writes the public code file of your default code: the public code and the
identity behind it, nothing secret. When an API key on this machine can read your list of codes,
the default is the lowest-numbered live one; with no key it is code 0, the code every NMTS key
starts with. `--save --as <n>` writes the file of code n instead and asks the server nothing.
Without a file name it writes `nmts-public-code-<public code>.nmtscode` in the current directory.
It needs the NMTS key. Whoever has the file can make
a handover file for you (`nmts handover make … --to <file>`) without looking your code up, so NMTS
does not learn who is sending to you. `--force` replaces a file that is already there. It is not
combined with `--publish`.

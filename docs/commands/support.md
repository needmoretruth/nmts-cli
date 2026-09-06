# nmts support — write to the developer of NMTS

Commands: support
Tiers: support=none · support.send=low

`support send` files a report: a bug, a confusing message, an idea, a question. It is optional,
always. A good report has four parts — the command you ran, what you expected, what happened, and
`--attach-log` so the server's answers to the last runs come along. `--category` (bug · idea ·
account · storage · payment · privacy; `nmts support --help` lists the finer ones), `--message`
or `--message-file`, `--omit <text>` for a value that must not travel. The log is redacted on this
machine before it leaves; the account code, key, passphrase and key material never go. Write in
English. One report per problem.

In the default mode it prints what it would send and asks (or takes `--yes`); in an auto mode it
sends after printing. Replies arrive in the thread: `support list`, `support show <code>`,
`support reply <code> --message`. If the CLI itself cannot run, the second door is nmts@nmts.me.

# nmts mcp — serve this account as MCP tools

Commands: mcp
Tiers: mcp=none

Serves most of this tool's commands as MCP tools on stdin/stdout. The person chose the directory
files land in when they started the server (`--out`), and no tool takes a destination. Each tool's
description starts with its tier, the listing carries the MCP hints (read-only, destructive), and
the same gate the command line runs sits before every call: a locked act is refused until a person
unlocks it at a terminal, and an act that needs the person's yes in this mode is put to them over
MCP elicitation — or refused, naming the way round it, when the client cannot ask.

The tools: `nmts_whoami` `nmts_list` `nmts_usage` `nmts_expiring` `nmts_balance` `nmts_shares`
`nmts_shares_sent` · `nmts_wallet_activity` `nmts_wallet_storage` · `nmts_devices` · `nmts_notices`
`nmts_notice` `nmts_terms` `nmts_privacy` · `nmts_losses` `nmts_loss_recheck` · `nmts_get`
`nmts_pull` `nmts_receive` · `nmts_put` `nmts_push` `nmts_padding` `nmts_deposit` · `nmts_public_code` ·
`nmts_mkdir` `nmts_move` `nmts_rename` `nmts_mark` `nmts_label_rename` `nmts_unlabel_all`
`nmts_trash` `nmts_restore` · `nmts_credits_transfer` · `nmts_share` `nmts_unshare` · `nmts_support_send`
`nmts_support_list` `nmts_support_show` `nmts_support_reply`.

Deliberately absent: signing in or out, keys and unlocks, the human check, permanent destruction,
rebuilding or rolling back the file list, and the recovery files. If one of those is what the work
needs, say so and let the person do it.

```
claude   mcp add nmts -- nmts mcp --out /where/files/should/land
codex    mcp add nmts -- nmts mcp --out /where/files/should/land
opencode mcp add nmts -- nmts mcp --out /where/files/should/land
```

A sealed stored code is opened once, at startup; `nmts mcp` never prompts, so a sealed code with
no `NMTS_PASSPHRASE` exits 3 at startup rather than hang. Arguments are checked against what each
tool declares — `"dry_run": "true"` is a refusal, not an upload.

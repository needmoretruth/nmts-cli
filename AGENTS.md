# nmts — for agents

You are reading this because someone pointed you at the `nmts` command, or at this repository.
This file is the working reference. It is short on purpose.

## What this tool does

`nmts` reads and writes files in an [NMTS](https://nmts.me) account. NMTS is end-to-end
encrypted: encryption and decryption happen where this command runs, and the server stores sealed
bytes it cannot open.

## Rules you must follow

**1. Never pass the account code as a command-line argument.** There is no flag that accepts it,
and adding one to a wrapper script would defeat the design. On Linux any process on the machine
can read another process's command line, and shells write it into history files.

Read it from the environment instead:

```sh
export NMTS_ACCOUNT_CODE="..."
nmts whoami
```

…or let the person store it once with `nmts login`, which writes `~/.nmts/credentials.json` with
mode `0600`.

**2. Never print the account code, and never write it anywhere it can be read again.** Not into
logs, not into a commit, not into a file you create, not into a message you send. It is the only
key to the account: the file keys and the wallet keys are all derived from it, and it cannot be
rotated while keeping the account. If you have echoed it, say so plainly — the person needs to
know, and the remedy is theirs.

**3. Do not guess the network.** `--network mainnet` and `--network testnet` are different
places. The wrong one does not error; it looks somewhere the files were never stored and reports
nothing found. If you were not told which, ask.

**4. Do not invent commands.** Run `nmts --help` and use what is there. Commands marked
`[not built yet]` are not stubs to work around — they do not exist.

**5. Two credentials, two jobs.** The **account code** opens the files and stays on this machine.
The **API key** makes the server answer without the human check a browser sign-in does — it opens
no file. `ls` needs both:

```sh
export NMTS_ACCOUNT_CODE="..."
export NMTS_API_KEY="..."
```

If there is no key, say so and stop. Do not try to sign in instead; that path needs a person.

## Commands that work today

```
nmts login       keep an account code on this machine
nmts logout      remove the stored account code
nmts whoami      which account the stored code belongs to — offline, no server call
nmts ls          list the files in the account
nmts --help      the current command list, with unbuilt ones marked
nmts --version   the version
```

`whoami` derives the account identifier and the public code from the stored account code without
contacting anything. It is the cheapest way to confirm a code is present and well-formed.

`ls --json` prints one JSON object on stdout: `{state, seq, entries: [{id, path, kind, size,
updatedAt, trashed}], hiddenTrashed, firstTimeOnThisMachine, serverSeqDisagreed}`. Parse that
rather than the table. Entries in the trash are omitted unless `--all`, and `hiddenTrashed` says
how many were left out — do not report a file as gone without checking it.

`ls` refuses rather than lists when the server offers a file list older than one this machine
already saw, or a different list at the same version number. Those are not transient errors and
must not be retried: report them to the person and stop.

## Commands that do not exist yet

`put` · `get`. They print what they are and exit non-zero. Do not shell out to something
else to fake them.

## Exit codes

`0` on success. Non-zero on any failure, with a human-readable reason on stderr. Read stderr
before deciding what went wrong; the reason is written to be actionable rather than to be parsed.

## If something fails

Say what the tool said. Do not retry a refusal in a loop — the failures this tool reports are
about a missing code, an unreachable server, or a command that does not exist, and none of those
are fixed by trying again.

## Licence, briefly

This program is AGPL-3.0-only. **Calling it from your own code does not put your code under the
AGPL** — running a separate program is not building a derived work out of it. See
[LICENSING.md](LICENSING.md) if you are asked about licensing.

## Source

<https://github.com/needmoretruth/nmts-cli>

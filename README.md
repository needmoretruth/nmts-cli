# nmts

Command-line access to [NMTS](https://nmts.me) — end-to-end encrypted storage on the Walrus
network. For people at a terminal, and for the agents they run.

> **If you are an AI agent, read [AGENTS.md](AGENTS.md) instead.** It says the same things in the
> order a program needs them, and it is the file to follow when a person points you at this tool.

> **Status: not released.** This is being built in the open. It is not on npm yet, and `ls`,
> `put` and `get` are not implemented. Nothing here is a promise about a shipped feature — the
> help output marks what is not built, and so does this file.

## What it is

NMTS encrypts on your machine. The server stores sealed bytes and holds no key to them. This
tool is that same thing without a browser, so a program working on your machine can read and
write your files.

## Install

Not published yet. From a clone:

```sh
npm install
npm run build
node dist/main.js --help
```

When it is published, `npm install -g nmts` will put `nmts` on your path.

Node 22 or newer. It is plain JavaScript with no native build step, so it runs wherever Node
runs — Linux, macOS, Windows, and inside a rootless container.

## The one thing to understand before using it

**Your account code is the only key to your account.** The keys that encrypt your files and the
keys to your wallet are all derived from it. Giving a program that code gives it everything at
once, and it cannot be undone: requests made with your code cannot be told apart from your own,
and the code cannot be changed while keeping the account.

Give an agent an account you would be willing to lose.

## Where the code is kept

Either an environment variable, read fresh on every run and never written down:

```sh
export NMTS_ACCOUNT_CODE="..."
```

…or a file this tool writes at `~/.nmts/credentials.json`, created `0600` so other users on the
machine cannot read it. On Windows Node does not apply file modes, so there the file inherits the
directory's permissions.

The environment variable wins when both are present.

**The code is never accepted as a command-line argument.** On Linux any process can read another
process's command line, and shells record it in history.

## Commands

| Command | What it does | |
|---|---|---|
| `nmts login` | Keep an account code on this machine | |
| `nmts logout` | Remove the stored account code | |
| `nmts whoami` | Show which account the stored code belongs to, without asking the server | |
| `nmts ls` | List files in the account | *not built yet* |
| `nmts put <file>…` | Encrypt and upload | *not built yet* |
| `nmts get <file>` | Download and decrypt | *not built yet* |

`nmts --help` prints the current list, and marks the same things.

## Networks

`--network mainnet` or `--network testnet`, or `NMTS_NETWORK`. It is never guessed: the wrong
network looks in a place your files were never stored, and answers "not found" rather than
"wrong network".

Against the live server the network is already known and the flag is optional. Against any other
server it is required.

## Licence

AGPL-3.0-only. The full text is in [LICENSE](LICENSE), verbatim.

Running `nmts` from your own script or agent does not put your code under the AGPL — that is one
program calling another, not one program built out of the other. If the AGPL does not fit what
you are building, a separate licence can be arranged: see [LICENSING.md](LICENSING.md).

This repository does not merge outside code, and [LICENSING.md](LICENSING.md) says why. Bug
reports, questions and ideas are welcome.

Copyright © 2026 needmoretruth.

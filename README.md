# nmts

Command-line access to [NMTS](https://nmts.me) — end-to-end encrypted storage on the Walrus
network. For people at a terminal, and for the agents they run.

> **[한국어 문서](README.ko.md)** · Talk about NMTS on [Discord](https://discord.gg/pcmRkVmVZk),
> in English or Korean.
>
> **If you are an AI agent, read [AGENTS.md](AGENTS.md) instead.** It says the same things in the
> order a program needs them.
>
> **Status: early.** The interface may still change before 1.0. `nmts --help` is the current truth
> about what exists.

## What NMTS is

Storage where **the encryption happens on your machine and the keys never leave it.** The server
receives sealed bytes it cannot open. File contents, names and folders all live inside a sealed
list that only your account code opens.

The bytes live on **Walrus**, a public storage network, paid for on the **Sui** chain. Three
things to know before you start:

- **Storage is bought for a period, not forever.** A file has a lease. It can be extended, and
  NMTS warns before one runs out.
- **There is no password reset.** Your account code *is* the account. It cannot be recovered or
  changed while keeping the files. That is the same property that stops anyone, including NMTS,
  from opening them.
- **Uploads here are paid with credits** that the account already holds. One command, `nmts extend`,
  pays from your own Sui wallet instead, and asks for a separate agreement first, because a signed
  purchase on a public chain cannot be reversed by anyone.

## Install

Node 22 or newer. Nothing is compiled at install time and there is no native build step: the
encryption engine is a WebAssembly module carried in the repository. It runs wherever Node runs —
Linux, macOS, Windows, and inside a rootless container.

```sh
npm install -g @needmoretruth/nmts-cli
nmts --help
```

The same package can be installed straight from this repository, without the registry — from the
default branch, from a pinned version, or from the tarball attached to the
[latest release](https://github.com/needmoretruth/nmts-cli/releases):

```sh
npm install -g github:needmoretruth/nmts-cli            # the default branch
npm install -g github:needmoretruth/nmts-cli#v0.20.0    # a pinned version
npm install -g https://github.com/needmoretruth/nmts-cli/releases/latest/download/nmts.tgz
```

The registry name carries the scope: `npm install -g nmts` finds nothing, because the registry refuses
that short name as too close to names already published.

To work on the source instead, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Staying up to date

```sh
nmts update            # installs the newest release over this one
nmts update --dry-run  # prints the versions and the command, changes nothing
```

Separately, once a day after a command finishes, the tool asks the releases page which version is
newest and remembers the answer. When a newer one exists, the next run prints one line on stderr.
That request carries no account code, no API key and no command name, and it is the only request
the tool makes that no command asked for. Setting `NMTS_NO_UPDATE_CHECK` to anything stops both
halves, and `nmts env` shows what the check last found.

## First run

```sh
nmts env       # what this machine is, and whether credentials are in reach. Contacts nothing.
nmts login     # keep the account code here, sealed, and take an API key
nmts ls        # list the files
nmts put x     # upload one file — spends credits
nmts get x     # download one file
```

Run `nmts env` first on any machine you do not know — a container, a CI runner, someone else's
laptop. It needs no credential and reports what a credential here would be exposed to.

## The two credentials

They do different jobs and they are not interchangeable.

| | What it does | How to give it |
|---|---|---|
| **Account code** | Opens your files. Every key in the account derives from it. Never goes to the server. | `NMTS_ACCOUNT_CODE_FILE=/path` (recommended) · `nmts login` · `NMTS_ACCOUNT_CODE` |
| **API key** | Makes the server answer. Made on the account screen at nmts.me. Opens no file. | `NMTS_API_KEY_FILE=/path` (recommended) · `NMTS_API_KEY` · `nmts login` |

`nmts ls` needs both: the key so the server answers, the code so the answer can be opened.

`nmts login` checks the key with the server before writing it down, prints the key's public handle
and never the key itself, and does not replace a stored key unless the run says so. `nmts logout`
clears what is stored.

`nmts whoami --reveal` prints the account code itself. That is a person's act: the tool refuses it
in `mode auto`, and anything that logs your terminal has the code from then on.

**Neither credential is ever accepted as a command-line argument.** Any process can read another
process's command line, and shells record it in history. There is no flag for either.

### Where the account code can live

| | What it does | Asks |
|---|---|---|
| `NMTS_ACCOUNT_CODE_FILE=/path` | Reads the code from a file it never copies | nothing |
| `nmts login` | Seals it under a passphrase at `~/.nmts/credentials.json` | nothing |
| `nmts login --plain` | Writes it in the clear, mode 600 | once, `unsafe-code-storage` |
| `NMTS_ACCOUNT_CODE`, holding the code | Uses it straight from the environment | once, `plain-env` |

A sealed code needs its passphrase for every command, from a terminal or from `NMTS_PASSPHRASE`.
Opening it costs a fraction of a second and 64 MiB of memory, which is what makes guessing the
passphrase expensive. A passphrase does not protect the code from anything running as you: on a
machine where an agent runs unattended, the passphrase has to be reachable too. That is why the
file form is the recommendation for agents — the code is never copied, and the permissions are the
host's to set.

An environment variable is not private: `docker inspect` prints it, anything running as you can
read `/proc/<pid>/environ`, every child process inherits it, and CI systems write it into logs.
That is why using one asks once. `nmts login --env` prints the line to set and writes nothing; it is
behind the same agreement.

**Under Codex, Hermes and OpenClaw an environment variable does not reach an MCP server.** All
three clear the environment before starting one. Sign in with `nmts login` instead, or put the
variables in the server's own `env` block. `nmts env` names the agent it can see.

## Before you hand this to an agent

Your account code is everything at once. A program that has it can read every file, upload,
delete and sign with the wallet, and its requests cannot be told apart from yours. It cannot be
rotated while keeping the account. **Use an account you would be willing to lose.**

## Commands

| Command | What it does |
|---|---|
| `nmts env` | Where this is running, and what that means. Needs nothing. |
| `nmts login` / `logout` | Keep or remove an account code and API key on this machine |
| `nmts whoami` | Which account the stored code belongs to — offline. `--reveal` prints the code |
| `nmts ls` | List the files |
| `nmts usage` | What the account holds: counts, bytes, the largest files, the trash |
| `nmts balance` | Credits left, what they buy, and the ceilings on spending |
| `nmts get <path>` | Download one file, decrypt it, check it |
| `nmts pull [folder]` | Download a whole folder, or the whole account, keeping its shape |
| `nmts put <file>` | Encrypt one file and upload it — **spends credits** |
| `nmts push <directory>` | Upload a whole directory, keeping its shape — **spends credits** |
| `nmts rm <paths>` | Move things to the trash — restorable for 30 days |
| `nmts restore <paths>` | Bring things back out of the trash |
| `nmts sweep` | Drop trash entries past their 30 days. **Cannot be undone** — asks every run |
| `nmts mkdir <path>` | Make a folder, and any folder above it that is missing |
| `nmts mv <paths> <folder>` | Move things into a folder. `/` is the top of the drive |
| `nmts rename <path> <name>` | Give one thing a new name |
| `nmts star` / `unstar` | Star files, or take the star off |
| `nmts pin` / `unpin` | Hold files at the top of their folder, or let them fall back |
| `nmts label <name> <files>` | Put one label on files. `unlabel` takes it off; `--rename` and `--all` sweep the whole list |
| `nmts on-collision` | What an upload does when its name is already taken |
| `nmts padding [mode]` | How file sizes are hidden on the storage network, and change it for the next uploads |
| `nmts expiring` | Which files run out of bought storage soon, and when |
| `nmts losses` | Storage NMTS bought for you that the daily check could not find on the chain. `--recheck <id>` asks again; `--dismiss <id>` takes a line off |
| `nmts extend <path>` | Buy more storage time for one file — **signs and spends from the wallet** |
| `nmts wallet` | The account's wallet address, and its SUI and WAL balances. Never signs |
| `nmts trial` | What is left of this week's free credits. `trial apply` asks for some |
| `nmts create` | Make a NEW account and print its code once. Nothing can print it again |
| `nmts verify` | Ask a person to pass the check that opens this account's limits |
| `nmts public-code` | The code other accounts send files to. `--publish` makes it reachable |
| `nmts share <path> <address>` | Give one file to another account — **withdrawing does not recall it** |
| `nmts shares` | What was shared with this account; `--sent <path>` shows who one file went to |
| `nmts receive <id>` | Download one file somebody shared with this account |
| `nmts unshare <id>` | Withdraw a share you sent, or remove one you were sent |
| `nmts rebuild` | Build a file list from the server's rows, for an account with none |
| `nmts rollback` | Put the previous version of the file list back — a person's act |
| `nmts listfile` | Write this machine's copy of the sealed file list out as a file |
| `nmts recovery-list` | Write the file that finds this account's bytes without NMTS |
| `nmts kit` | Recovery kit: that list **and the account code**, together in one file |
| `nmts recovery` | Download the standalone program that reads files back without NMTS |
| `nmts consent` | What this machine has agreed to, and take it back |
| `nmts mode` | How much an agent driving this tool may decide without asking |
| `nmts update` | Install the newest published release of this tool |
| `nmts mcp` | Serve a subset of the above as tools over the Model Context Protocol |
| `nmts s3` | Serve the drive to any S3 program, on this machine only |

### Listing and fetching

`ls` takes `--json`, `--all` (include the trash; the count always says how many were hidden),
`--find <text>` (files whose name contains the text, with the folders that hold them), `--sort
name|size|date` and `--desc`.

`get` takes `--out` and `--force`. It never leaves a half-right file: the bytes are written under a
temporary name in the same directory and renamed into place only once the whole-file hash
matches. One part is held in memory at a time, not the file. `--out -` sends the file to stdout
instead of writing it, with everything a person reads on stderr; a pipe cannot be taken back, so
that mode proves the whole file first and refuses above 64 MiB.

`pull` fetches each file on its own. One that will not come back is named at the end and the rest
stay on disk. Files already in the destination are skipped and counted; `--force` replaces them.

### Uploading

```sh
nmts put report.pdf --dry-run          # what it would cost. Sends nothing, charges nothing.
nmts put report.pdf --to notes         # into an existing folder
nmts put film.mov --part-size 256MiB   # bigger parts: fewer purchases, more memory
```

One credit per started mebibyte, printed before anything is spent. A name already taken in that
folder gets a numbered copy (`report (2).pdf`) unless `nmts on-collision` says otherwise; NMTS keeps
no previous versions, so replacing is permanent. A file larger than one part (64 MiB by default) is
split and each part bought separately; a run that stops partway is finished by running the same
command again, which buys only the parts that were never bought. The same is true after any
interrupted upload: the retry costs nothing more.

`push` uploads a directory and **stops at the first failure**, saying what is already uploaded.
Files whose name is already in the destination are skipped, so running it again is safe. Names
beginning with a dot are left alone unless `--hidden` is given, and symbolic links are not followed.

`nmts padding` shows how file sizes are hidden, and `nmts padding standard` or `nmts padding pow2`
changes it for every device's next uploads. Anyone can read the size of a piece on the storage
network; blank bytes make that size one of a set of fixed values. Powers of two hide more and cost
more storage on average.

### Names, folders and the trash

```sh
nmts mkdir photos/2026/august   # makes all three if they are missing
nmts mv report.pdf photos       # `/` moves it back to the top of the drive
nmts rename report.pdf "q3 report.pdf"
nmts rm photos/2026             # to the trash, with every file under it
nmts restore photos/2026
```

None of these costs anything or asks anything: a name, a folder and a parent live only in your
sealed file list, and the server holds no place to put a name. `rm` never destroys; each trashed
file keeps its own thirty-day clock. The command that erases for good is deliberately not in this
tool. A path is matched whole (`photos/a.jpg` is not `a.jpg`), and a path that matches two entries
is refused rather than resolved. `rm`, `restore` and `mv` take several paths in one write; a path
that names nothing stops the whole run before anything is touched.

`nmts label --rename <old> <new>` renames a label on every file that carries it, and
`nmts unlabel <name> --all` takes it off all of them. Both change only the file list.

### Money and time

`balance` answers "what can I still buy": credits left, said as bytes too, and the ceilings on
spending. `usage` answers "what do I have". `expiring` says when stored files run out.

`extend` buys more time for a stored file **from the wallet the account code derives**, on a public
chain. It asks for the `wallet` agreement once per machine and takes `--dry-run`, which touches no
key. `wallet` only reads: the address is derived on this machine, and a balance that could not be
read is reported as unread, not as zero.

### Sharing

`share` needs the other account's public code, read off their account screen. There is no
directory and no name lookup; a mistyped code is caught by its own check symbol. Withdrawing a
share stops further downloads and cannot reach a copy already taken, which is why sharing asks
for an agreement the first time.

`public-code` prints the value other accounts send files to and says whether it is published.
Until it is published nobody can send to you. `--publish` writes it, permanently: it derives from
your account code, so it cannot be chosen or changed. It is not your account code, and it opens
nothing on its own.

`nmts shares --sent <path>` lists who one file was shared with — the recipient address, since when,
and the share id `unshare` takes.

### Recovery

`recovery-list` writes the encrypted file that locates your bytes on the storage network; it holds
no account code. `kit` writes that list together with the account code in one file, so whoever
holds a kit holds the account. `recovery` downloads the standalone recovery program for this
machine, checks it against the release's checksum file before making it runnable, and never puts
anything on your PATH. `rebuild` reconstructs a file list from the server's rows for an account
that has lost its own: keys, hashes, dates and sizes come back; names and folders do not.

`nmts rollback` puts the previous version of the file list back as the current one, for the case
where the current one will not open. Files the newer version added are out of the list afterwards —
their bytes are still stored, and `nmts rebuild` finds files the list does not name. It is a
person's act and refused in `mode auto`.

### When storage goes missing

`nmts losses` lists the storage objects NMTS bought with your credits that the daily check could not find on the chain — the object id and the day a check first missed it. There is no file name: the server cannot pair the two, and NMTS cannot see the file. `nmts losses --recheck <id>` asks the chain again now. `nmts losses --dismiss <id>` takes a line off once you have read it; that is a person's act, and the tool refuses it in `mode auto`. The incident stays in a record that names nobody; the same finding is posted on the notice board by day.

### The check a person has to pass

An API key makes the server answer; it does not stand in for somebody being there. While nobody
has checked in lately, the account still works under tighter limits, and a few requests are
refused outright.

```sh
nmts verify --status   # is the check live, and until when?
nmts verify            # prints a short code for a person to type at nmts.me, then waits
```

Neither the tool nor an agent can pass the check. It prints the moment the check ends rather than
a number of days, because the window ends on a boundary of the server's own weeks.

## What it stops to ask about

Five things, once per machine: **spending credits**, **storing the account code unsealed**,
**using it from a plain environment variable**, **giving another account one of your files**, and
**signing with the wallet**. Each prints what would happen, what could go wrong, and the one
command that agrees. `nmts sweep` asks every run instead, because it destroys this account's copy
of the keys for those files. Listing, downloading, renaming and moving never stop for anyone.
`nmts consent` shows what has been agreed to and can take it back.

## Containers

It runs unchanged in Docker and Podman, rootless. There is no published image; this repository has
a `Dockerfile`, and both container tools build and run it on every push.

```sh
docker build -t nmts .        # or: podman build -t nmts .
docker run --rm nmts --version
```

The image runs as an ordinary user and writes to `/config`, which it creates, so a volume mounted
there works. Give credentials as files, never as environment variables inside a container:

```sh
printf '%s' "$CODE" > /tmp/nmts-code && chmod 600 /tmp/nmts-code
printf '%s' "$KEY"  > /tmp/nmts-key  && chmod 600 /tmp/nmts-key
docker run --rm \
  -v /tmp/nmts-code:/run/secrets/nmts:ro \
  -v /tmp/nmts-key:/run/secrets/api-key:ro \
  -e NMTS_ACCOUNT_CODE_FILE=/run/secrets/nmts \
  -e NMTS_API_KEY_FILE=/run/secrets/api-key \
  nmts ls
```

A credential file that is named but missing is a hard stop (exit 3) before any request.

Agreements live in the config directory, and a container that is removed takes them with it, so a
fresh container can list and download but refuses to upload. Either bake the agreement into the
image (`RUN nmts consent grant spend`) or keep the config directory outside the container
(`-v nmts-config:/config`). On an image of your own, `NMTS_CONFIG_DIR` moves everything the tool
writes to a directory you choose; `nmts env` reports where it landed and whether it survives.

## Serving the drive to S3 tools

`nmts s3` starts a server on this machine that speaks the S3 protocol, so rclone, the AWS CLI or
any backup program that knows S3 can list and download this account's files.

```
$ nmts s3
  This account's drive is being served at http://127.0.0.1:9000, to this machine only.
  endpoint        http://127.0.0.1:9000
  bucket          drive
  access key id   NMTS…
  secret key      …
```

- One bucket, `drive`. A key is the file's path without the leading slash. Folders come back as
  common prefixes, including empty ones.
- The credentials are made when the command starts, stored nowhere, and die with it.
- It listens on 127.0.0.1 only, with no option to change that.
- Uploading and deleting need the spending agreement; without it the drive is served read-only and
  every write is refused with a sentence saying so. Deleting puts a file in the trash.
- A key that already holds the **same** file is answered `200` and nothing is sent: content is
  compared, not names, so a nightly backup pays only for files that changed. A key that holds a
  **different** file is refused with `409`, because this drive does not replace files.
- Large files go up in pieces, checked against the hash the client signed for; nothing is stored
  until every piece is in.
- The modification time is not carried across, and a file uploaded from another device can take
  five seconds to appear.

With rclone:

```
$ rclone config create drive s3 provider=Other region=us-east-1 \
    endpoint=http://127.0.0.1:9000 \
    access_key_id=<the id printed above> secret_access_key=<the secret printed above>
$ rclone lsf -R drive:drive
$ rclone copy drive:drive ./somewhere
$ rclone copy --size-only ./somewhere drive:drive
```

## For an agent that speaks MCP

`nmts mcp` is a local MCP server over stdin and stdout. Sign in first (`nmts login`); it never
takes a code on a command line, and it never prompts, so a sealed code with no `NMTS_PASSPHRASE`
makes it exit 3 at startup.

```
$ claude   mcp add nmts -- nmts mcp --out /where/files/should/land
$ codex    mcp add nmts -- nmts mcp --out /where/files/should/land
$ opencode mcp add nmts -- nmts mcp --out /where/files/should/land
```

Hermes and OpenClaw pass the arguments one at a time (`--args` in Hermes, a repeated `--arg` in
OpenClaw); their `mcp add --help` prints the shape. Any other client takes the command `nmts` and
the arguments `mcp --out <directory>`, for example in opencode's own file:

```json
{ "mcp": { "nmts": { "type": "local", "command": ["nmts", "mcp", "--out", "/where/files/should/land"] } } }
```

It offers twenty-six tools: reading the account (`nmts_whoami`, `nmts_list`, `nmts_usage`,
`nmts_expiring`, `nmts_balance`, `nmts_shares`, `nmts_shares_sent`), storage the daily check could
not find (`nmts_losses`, `nmts_loss_recheck`), fetching (`nmts_get`, `nmts_pull`, `nmts_receive`),
uploading (`nmts_put`, `nmts_push`, `nmts_padding`), rearranging (`nmts_mkdir`, `nmts_move`,
`nmts_rename`, `nmts_mark`, `nmts_label_rename`, `nmts_unlabel_all`, `nmts_trash`, `nmts_restore`)
and sharing (`nmts_public_code`, `nmts_share`, `nmts_unshare`).

It deliberately does not offer credentials and agreements, the check a person has to pass,
permanent destruction, rebuilding a lost file list or putting the previous one back, or writing the
recovery files — those are yours. Nothing it offers can write outside the directory you name, and a wrong argument is refused
rather than guessed at. It is implemented directly, with no MCP SDK dependency.

## Letting an agent decide for itself

By default the tool asks you before anything that has not been agreed to, and an agent driving it
is told not to answer for you.

```
$ nmts mode                                        # what is set now
$ nmts mode auto --i-accept-the-risk               # the agent judges, and goes ahead
$ nmts mode skip-permissions --i-accept-the-risk   # the agent goes ahead
$ nmts mode off                                    # back to asking
```

While one is on, every command says so on stderr. The agreements are still recorded one at a time,
with dates; what changes is that an agent may record them on your behalf.

## Networks and retries

`--network mainnet` or `--network testnet`, or `NMTS_NETWORK`. Against the live server it is
already known; against any other server it is required, because the wrong network answers
"not found" rather than "wrong network".

A connection that was refused, reset or never made is retried with a growing wait for about
twenty seconds, and the wait is announced. A refusal from the server, a request that ran out of
its thirty seconds, and a write without an idempotency key are not retried: the two calls that pay
carry such a key and are safe to repeat, nothing else that writes is.

## Something wrong?

Write to **nmts@nmts.me** — a fault, a confusing message, a missing feature, anything that got in
the way. Say what you ran and what it said. Questions about the service itself, and reports about
content, go through the contact desk on [nmts.me](https://nmts.me).

## Built on this?

If you built something on this code — a service, a fork, a port to another language, a lighter
client — you owe us nothing: Apache-2.0 asks for the notices and nothing more. We would still like
to know. Write to **nmts@nmts.me**, or open an issue here if public is fine with you. If you want
it listed, say so: [SHOWCASE.md](SHOWCASE.md) carries a link and up to ten lines about each
project, in English ([SHOWCASE.ko.md](SHOWCASE.ko.md) in Korean), written by the people who made it. A listing is not an
endorsement, and we may decline or remove one without giving a reason.

## Licence

Apache-2.0 — the full text is in [LICENSE](LICENSE). It moved here from AGPL-3.0-only on
2026-08-30; copies already held under the AGPL stay under it.

Build on it, ship it, sell what you build with it. If you need different terms, write to
**nmts@nmts.me** and say why — see [LICENSING.md](LICENSING.md). Code is welcome:
[CONTRIBUTING.md](CONTRIBUTING.md) says how it reaches here, and the
[Contributor License Agreement](CLA.md) is what keeps the offer above true for the whole program.

Copyright © 2026 needmoretruth.

# nmts

Command-line access to [NMTS](https://nmts.me) — end-to-end encrypted storage on the Walrus
network. For people at a terminal, and for the agents they run.

> **[한국어 문서](README.ko.md)**
>
> **Talk about NMTS — [Discord](https://discord.gg/pcmRkVmVZk).** Questions, ideas, and
> what people are building with it. English or Korean; both are read.

> **If you are an AI agent, read [AGENTS.md](AGENTS.md) instead.** It says the same things in the
> order a program needs them, and it is the file to follow when a person points you at this tool.

> **Status: early.** Built in the open, and the interface may still change before 1.0. Nothing here is a promise about a shipped feature — `nmts --help` is the current truth
> about what exists.

## What NMTS is

Storage where **the encryption happens on your machine and the keys never leave it.** The server
receives sealed bytes and has no way to open them; the file contents, the names and the folder
structure are all inside a sealed list only your account code opens.

The bytes themselves live on **Walrus**, a public storage network, paid for on the **Sui** chain.
Two consequences worth knowing before you start:

- **Storage is bought for a period, not forever.** A file has a lease. It can be extended, and
  NMTS warns before one runs out.
- **There is no password reset.** Your account code *is* the account. It is not recoverable and it
  cannot be changed while keeping the files — that is the same property that stops anyone,
  including NMTS, from opening them.

There are two ways to pay: **credits**, where NMTS's treasury buys the storage and your account
spends credits it already holds, or **your own Sui wallet**, which signs the purchase itself on a
public chain. Uploading here always uses credits. One command uses the wallet — `nmts extend`,
which buys more time for a file that is already stored — and it asks for a separate agreement
before it signs, because a signed purchase is not something NMTS can reverse.

## Install

Node 22 or newer. One line, straight from this repository:

```sh
npm install -g github:needmoretruth/nmts-cli
nmts --help
```

That takes the default branch. To pin a version, name a tag:

```sh
npm install -g github:needmoretruth/nmts-cli#v0.6.0
```

Or from the tarball on the [latest release](https://github.com/needmoretruth/nmts-cli/releases),
which is the same package and needs no clone:

```sh
npm install -g https://github.com/needmoretruth/nmts-cli/releases/latest/download/nmts.tgz
```

**It is not on a package registry, and `npm install -g nmts` will not find it.** That name is
unclaimed; nothing is published under it. If that changes, this section will say so and name the
command. Nothing else about installing changes: the repository stays the source either way.

**Nothing is compiled at install time**, and `dist/` is in this repository for that reason:
installing straight from a repository cannot build, because npm prepares it in a staging clone
where the compiler is not there. A committed build can drift from what produced it, so this
repository's own checks rebuild it on every push and refuse if one byte differs.

To work on it rather than install it:

```sh
git clone https://github.com/needmoretruth/nmts-cli
cd nmts-cli
npm install
node src/main.ts --help
```

`npm run compile` refreshes `dist/`, and `node dist/main.js` runs it — the same file the installed
command runs. It is called `compile` and not `build` for a reason worth knowing before renaming
it: on npm 11, a package with a script named `build` installs from a git URL by linking npm's own
temporary clone and then deleting it, which leaves a broken command and **reports success**.

**There is no native build step and no C compiler anywhere in this**: the encryption engine is a
WebAssembly module carried in the repository. It runs wherever Node runs — Linux, macOS,
Windows, and inside a rootless container. Starting it costs about 80 milliseconds, and commands
load only what they need.

## Staying up to date

```sh
nmts update
```

It reads which release is newest, prints the version running and the version published, and
installs the newer one with `npm install --global` from that release's own address. `--dry-run`
prints the command and stops. Run from a source checkout rather than an installed copy, it
refuses: installing would leave two copies and the PATH would decide which one runs.

Separately, **once a day, after a command has finished**, it asks
`https://github.com/needmoretruth/nmts-cli/releases/latest` which release is newest and writes the
answer down. When that is newer than the version running, the next run prints one line on stderr
saying so — stderr, so it cannot land in the output of `--json`.

That request carries no account code, no API key and no command name: it asks for a page address,
and what the site can see is that somebody asked for it. It is the only request this tool makes
that no command asked for; everything else goes to the NMTS server or to the storage network
because something needed it.

Set `NMTS_NO_UPDATE_CHECK` to anything and both halves stop — the lookup and the notice.
`nmts env` shows what the check last found, or why it did not answer.

## First run

```sh
nmts env
```

It contacts nothing and needs no credential. It reports what this machine is, whether a file
written here can actually be kept private, whether a browser could be opened, and whether it can
already see your credentials. On anything unfamiliar — a container, a CI runner, someone else's
laptop — run this first.

## The two credentials

They do different jobs and they are not interchangeable.

**The account code opens your files.** Every key in the account derives from it: the file keys, the
sealed list, the wallet. It never goes to the server.

```sh
export NMTS_ACCOUNT_CODE_FILE=/path     # name a file holding it — the recommended way
nmts login                              # …or keep it here, sealed under a passphrase
export NMTS_ACCOUNT_CODE="..."          # …or hand it over directly (asks once, see below)
```

**The API key makes the server answer.** Signing in normally needs a human check that no
command-line tool can pass; a key, made on the account screen at [nmts.me](https://nmts.me),
waives that and nothing else. **It opens no file.**

```sh
export NMTS_API_KEY_FILE=/path          # name a file holding it — the recommended way
export NMTS_API_KEY="..."               # …or hand it over directly
nmts login                              # …and this writes down whichever it finds, or asks
```

`nmts ls` needs both: the key so the server answers, the code so the answer can be opened.

`nmts login` checks a key with the server before it writes it down, so a wrong one is wrong at the
moment it is pasted rather than at the next command. It prints the key's public handle and never
the key itself. A key already stored is not replaced by a run that did not say so: at a terminal
`login` asks, and where there is no terminal `nmts logout` clears what is there first.

**Neither credential is ever accepted as a command-line argument.** On Linux any process can read another
process's command line, and shells record it in history. There is no flag for either, deliberately.

## Where the code can live

Four places, and the tool has an opinion about each. Nothing is unreachable: what changes is
whether it happens by accident.

| | What it does | Asks |
|---|---|---|
| `NMTS_ACCOUNT_CODE_FILE=/path` | Reads the code from a file it never copies | nothing |
| `nmts login` | Seals it under a passphrase at `~/.nmts/credentials.json` | nothing |
| `nmts login --plain` | Writes it in the clear, mode 600 | once, `unsafe-code-storage` |
| `NMTS_ACCOUNT_CODE`, holding the code | Uses it straight from the environment | once, `plain-env` |

**`nmts login` seals by default.** What lands on disk is not the code: opening it needs a
passphrase, so a copy of that file in a backup, a synced folder, a container image or a stolen
laptop is worth nothing on its own. Every command that needs the code asks for the passphrase, or
reads it from `NMTS_PASSPHRASE`. That costs a fraction of a second and 64 MiB of memory each
time — which is the point, because it is what makes guessing the passphrase expensive.

⚠ **A passphrase does not protect the code from anything running as you.** Whatever supplies the
passphrase can be read the same way. On a machine where an agent runs unattended, `NMTS_PASSPHRASE`
has to be somewhere the agent can reach, and at that point the lock has its key taped beside it.
That is why the file form — `NMTS_ACCOUNT_CODE_FILE` — is the recommendation for agents rather
than a lesser option: the code is never copied anywhere, and the permissions are the host's to set.

**An environment variable is not private, which is why using one asks.** `docker inspect` prints
the whole environment of a container. Anything running as you can read `/proc/<pid>/environ` for as
long as the process lives. Every child process inherits it, and continuous-integration systems
routinely write it into a log. A variable naming a *file* has none of those, and asks nothing.

**`nmts login --env` prints the line to set and writes nothing** — the one command that puts the
code on your screen, and the reason it is behind the same agreement.

**What you do with the code outside this tool is yours.** Putting it in a note, a password manager
or a repository is not something the tool can see, and it is not something it tries to stop. What
it can do is make the shape *it* writes a decision somebody took on purpose.

## Before you hand this to an agent

Your account code is everything at once. A program that has it can read every file, upload,
delete, and sign with the wallet — and requests made with it cannot be told apart from your own.
It cannot be rotated while keeping the account.

**Use an account you would be willing to lose.**

## Commands

| Command | What it does |
|---|---|
| `nmts env` | Where this is running, and what that means. Needs nothing. |
| `nmts login` / `logout` | Keep or remove an account code on this machine |
| `nmts whoami` | Which account the stored code belongs to — offline, no server call |
| `nmts expiring` | Which files run out of bought storage soon, and when |
| `nmts extend <path>` | Buy more storage time for one file — **signs and spends from the wallet** |
| `nmts create` | Make a NEW account and print its code once. Nothing can print it again |
| `nmts trial` | What is left of this week's free credits. `trial apply` asks for some |
| `nmts recovery-list` | Write the file that finds this account's bytes without NMTS |
| `nmts kit` | Recovery kit: that list **and the account code**, together in one file |
| `nmts sweep` | Drop trash entries past their 30 days. **Cannot be undone** — asks every run |
| `nmts consent` | What this machine has agreed to |
| `nmts update` | Install the newest published release of this tool |
| `nmts ls` | List the files |
| `nmts usage` | What the account holds: counts, bytes, the largest files, the trash |
| `nmts get <path>` | Download one file, decrypt it, check it |
| `nmts pull [folder]` | Download a whole folder, or the whole account, keeping its shape |
| `nmts push <directory>` | Upload a whole directory, keeping its shape — **spends credits** |
| `nmts put <file>` | Encrypt one file and upload it — **spends credits** |
| `nmts rm <paths>` | Move things to the trash — restorable for 30 days |
| `nmts restore <paths>` | Bring things back out of the trash |
| `nmts mkdir <path>` | Make a folder, and any folder above it that is missing |
| `nmts mv <paths> <folder>` | Move things into a folder. `/` is the top of the drive |
| `nmts rename <path> <name>` | Give one thing a new name |
| `nmts star` / `unstar` | Star files, or take the star off |
| `nmts pin` / `unpin` | Hold files at the top of their folder, or let them fall back |
| `nmts label <name> <files>` | Put one label on files. `unlabel` takes it off |
| `nmts rebuild` | Build a file list from the server's rows, for an account with none |
| `nmts listfile` | Write this machine's copy of the sealed file list out as a file |
| `nmts share <path> <address>` | Give one file to another account — **withdrawing does not recall it** |
| `nmts shares` | What was shared with this account |
| `nmts receive <id>` | Download one file somebody shared with this account |
| `nmts unshare <id>` | Withdraw a share you sent, or remove one you were sent |
| `nmts wallet` | The account's wallet address, and its SUI and WAL balances |
| `nmts verify` | Ask a person to pass the check that opens this account's limits |
| `nmts mcp` | Serve a subset of the above as tools over the Model Context Protocol |
| `nmts s3` | Serve the drive to any S3 program, on this machine only |

`ls` takes `--json` and `--all` (include the trash). Trashed entries are hidden by default and the
count always says how many were hidden. `--find <text>` keeps only files whose name contains the
text; folders appear only where they hold a match, and the listing says out loud what the query
left out. `--sort name|size|date` and `--desc` change the order.

`share` needs an address, which the other account reads off their own account screen — there is no
directory and no name lookup, so a mistyped address is caught here by the check symbol built into
it rather than by asking the server about somebody. **Withdrawing a share stops further downloads
and cannot reach a copy they have already taken.** That is what handing somebody a file means, and
it is why sharing asks for an agreement the first time.

`pull` fetches each file on its own: one that will not come back is named at the end and the rest
are still on disk, because refusing the whole thing over one file is how somebody runs it twenty
times and loses the same nineteen files each run. Files already in the destination are **skipped
and counted**, never replaced — `--force` replaces, and that cannot be undone.

`push` is the other direction, and it behaves differently on purpose. `pull` costs nothing, so it
carries on past a file that will not come back; `push` **spends**, so it stops at the first failure
and says what is already uploaded — those files are real and paid for, and running the same command
again sends only the rest. Files whose name is already in the destination are **skipped**, which is
what makes running it again safe: this tool never replaces a file, so without that a second run
would pay for numbered copies of everything. Names beginning with a dot are left alone unless
`--hidden` is given, because a directory of source code carries its credentials in exactly those
files and an upload goes to a public storage network. Symbolic links are not followed.

`rm`, `restore` and `mv` take several paths and make **one** list write. A path that names nothing
stops the whole run before any server row is touched: doing four of five and exiting 0 reads as
"finished", and which one was missed can only be found by comparing the drive.

`rebuild` is for an account whose sealed list is gone but whose files are still stored. It rebuilds
from the server's own rows — the file keys, the hashes, the dates, the sizes and what was in the
trash all come back; the names, the folders and the arrangement do not, and it says so. It writes
nothing without `--yes`, and it refuses outright if a list already exists.

`wallet` reads; it never signs, sends or spends. The address is derived on this machine from the
account code, so `nmts wallet address` needs no network at all. A balance that could not be read is
reported as unread — not as zero.

`get` takes `--out` and `--force`. It refuses rather than writing a half-right file: a part that
will not decrypt, parts that do not add up, or a whole-file hash that does not match all leave
nothing at the name you asked for. A file on disk is a claim that it is the file. The bytes are
written as they arrive, under a temporary name in the same directory, and that file is renamed
into place only once the whole-file hash matches. The file is never held in memory; one part
at a time is, so what a machine needs is the part size the uploader chose rather than the size
of the file. A download that fails takes its temporary file with it.

`--out -` sends the file to whatever is reading this program instead of writing it, so reading one
stored file need not leave a copy on the disk. Everything a person reads goes to stderr in that
mode. It refuses to send bytes a terminal would act on — redirect or pipe it. A pipe has no
rename, so that mode proves the whole file before it sends a byte, which means holding it: above
64 MiB it refuses and says to use `--out <name>` instead.

`put` takes `--dry-run`, `--name` and `--to`:

```sh
nmts put report.pdf --dry-run       # what it would cost. Sends nothing, charges nothing.
nmts put report.pdf --to notes      # into an existing folder
nmts put film.mov --part-size 256MiB  # bigger parts: fewer purchases, more memory
```

One credit per started mebibyte, printed before anything is spent. A name already taken in that
folder is numbered (`report (2).pdf`) rather than replacing what is there — NMTS keeps no previous
versions, so replacing would be permanent.

A file larger than one part is split, and **each part is bought separately**. The file is read a
slice at a time, so its size is not bounded by memory; the part size is (64 MiB by default). Each
part is written down before its own purchase, so a run that stops partway is finished by running
the same command again — it buys only the parts that were never bought.

### `nmts balance` and `nmts public-code`

`balance` asks the server what this account can still pay for: credits left, the same number said
as bytes so it means something, how much is already held, and the ceilings on spending. It is not
the same question as `usage` — that one adds up the sealed file list and answers "what do I have",
this one reads the ledger and answers "what can I still buy". It does not read the storage
network's clock, so for *when* stored files expire it points at `nmts expiring` rather than
printing a second deadline from a different source.

`public-code` prints the value other accounts send files to — the same **public code** the browser
shows on the account screen, in the same grouped form — and says whether it has been published.
Until it is published nobody can send to you: a sender needs the key behind it, and the server is
where they look. `nmts public-code --publish` writes it.

That write is permanent: it cannot be withdrawn or changed. It is also not a choice — it comes
from your account code, so the same account code produces the same public code on any machine, and
the server refuses one that is not the fingerprint of its own key. If the server already holds a
*different* public code for this account, the command stops and says what that means: the account
code on this machine is not the one the account was made with.

⛔ It is not your account code. That one opens every file you have and is never given to anybody;
this one is meant to be given away and opens nothing on its own.

Sending a file publishes it as a side effect, because a share cannot exist without one. Receiving
is the case this command is for.

### `nmts recovery` — fetch the recovery program

The separate recovery program restores files from the storage network with your account code, a
recovery list and nothing else — no NMTS server involved. Until now getting it meant installing a
Rust toolchain and building it, which is a fair ask of somebody auditing it and an unfair one of
somebody who has just lost access to their files.

```sh
nmts recovery --out ~/tools
```

It works out which executable this machine needs, fetches the checksum file for the release first
and takes the release's own name out of that request, then fetches the executable **from that same
release** so the two can never come from different ones. The bytes are hashed and compared before
anything is made runnable; a mismatch deletes the file and refuses. It never replaces a file
already at that name without `--force`, and it never puts anything on your PATH.

It prints the release, the address it came from and the hash, and says plainly what that check
does and does not prove: it proves the bytes are the bytes that release published; it proves
nothing about who published the release. The source is in the open and so is the workflow that
built it — that is the part worth checking.

## The check a person has to pass

An API key makes the server answer; it does not stand in for somebody being there. The server
keeps that as a separate question — has anybody checked lately that a person is behind this
account — and while the answer is no, the account still works under tighter limits, with some
requests refused outright.

```sh
nmts verify --status   # is the check live, and until when?
nmts verify            # prints a short code for a person to type at nmts.me, then waits
```

`nmts verify` cannot pass the check for you, and neither can an agent running it: that is what is
being checked. It prints a code and an address, and waits until the code is used or stops working.
Ctrl-C ends the waiting and not the code.

It prints the moment the check **ends** rather than a number of days, because the window ends on a
boundary of the server's own weeks — one passed shortly before a boundary is a short one, and the
absolute moment is the only honest way to say that.

## Names, folders and the trash

```sh
nmts mkdir photos/2026/august   # makes all three if they are missing
nmts mv report.pdf photos       # `/` moves it back to the top of the drive
nmts rename report.pdf "q3 report.pdf"
nmts rm photos/2026             # to the trash, with every file under it
nmts restore photos/2026
```

**None of these costs anything or asks anything.** A name, a folder and a parent live only in your
sealed file list — the server holds an id, a size and a time, and has no place to put a name. So
renaming and moving are invisible to NMTS, instant, and free.

`rm` never destroys: it moves one thing to the trash, where it stays restorable for thirty days.
The command that erases for good is deliberately not in this tool — a verb with no undo belongs to
a person at a browser. Trashing a folder trashes what is under it, and each file keeps its own
thirty-day clock, so restoring the folder does not resurrect something you threw away last week.

A path is matched **whole**: `photos/a.jpg` and `a.jpg` are different things, and a path that
matches two entries is refused rather than resolved to whichever came first.

If an upload is interrupted after the credits move, **running the same command again finishes it**
and costs nothing more. The sealed bytes and the reservation are written down before the money
moves, so a retry pushes exactly the blob that was bought rather than buying a second one.

## Containers

It runs unchanged in Docker and Podman, rootless.

```sh
printf '%s' "$CODE" > /tmp/nmts-code && chmod 600 /tmp/nmts-code
docker run --rm -u 1000:1000 \
  -v /tmp/nmts-code:/run/secrets/nmts:ro \
  -e NMTS_ACCOUNT_CODE_FILE=/run/secrets/nmts \
  -e NMTS_API_KEY_FILE=/run/secrets/api-key \
  nmts ls
```

**Do not put the account code in an environment variable inside a container.** The whole
environment is visible to anyone who can inspect it — `docker inspect` prints it. A variable
holding a *path* gives that reader a filename and nothing else. `NMTS_ACCOUNT_CODE_FILE` works
with `--secret` mounts, tmpfs, and ordinary bind mounts.

`nmts env` tells you which container runtime it is in, whether root here is root on the host, and
whether the directory it would write to survives the container being removed.

## What it stops to ask about

Five things, once per machine: **spending credits**, **storing the account code unsealed**, **using
it from a plain environment variable**, **giving another account one of your files**, and
**signing with the wallet**. Each prints what would happen, what could go wrong, and the one
command that agrees.

The last of those belongs to one command: `nmts extend`, which buys more storage time for a file
that is already stored. Everything else here is paid for with credits, which NMTS issues and can
put right; that one signs a purchase on a public chain, and nobody — NMTS included — can reverse
it. That is why it has an agreement of its own rather than sharing the one for spending.

Nothing else asks *once per machine*. One command asks *every run* instead: `nmts sweep`, which
drops trash entries whose thirty days have run out. That destroys this account's copy of the key
for those files, so a grant given once would make every later sweep silent. Listing, downloading,
renaming and moving never stop for anyone.

`nmts consent` shows what has been agreed to and can take it back.

## Serving the drive to S3 tools

`nmts s3` starts a server on this machine that speaks the S3 protocol. Point rclone, the AWS CLI, or
any backup program that already knows S3 at it, and it lists and downloads this account's files.

```
$ nmts s3
  This account's drive is being served at http://127.0.0.1:9000, to this machine only.

  endpoint        http://127.0.0.1:9000
  bucket          drive
  access key id   NMTS…
  secret key      …
```

- **One bucket, named `drive`.** A key is the file's path without the leading slash, so
  `photos/a.jpg` in the drive is `photos/a.jpg` here. Folders come back as common prefixes,
  including empty ones — this drive has real folders and hiding them would describe a different
  drive from the one in the browser.
- **The credentials are made when the command starts and are stored nowhere.** They stop working
  when it stops.
- **It listens on 127.0.0.1, and there is no option to change that.** One signature stands between
  a request and every file in the account, and the key it checks was printed on a terminal.
- **Uploading and deleting work, and both need the spending agreement.** Uploading spends credits,
  so a machine that has not run `nmts consent grant spend` serves the drive read only and says so
  — every write is refused with that sentence rather than answered.
- **Deleting puts a file in the trash**, where it stays recoverable for thirty days.
- **A key that already holds the SAME file is answered `200`, and nothing is sent.** What is
  compared is the file's content, not its name: every upload records a hash of the plaintext,
  sealed so only this account can read it, and the gateway compares the arriving bytes against it.
  So a backup that runs every night pays for the files that changed and nothing for the rest.
- ⛔ **A key that holds a DIFFERENT file is refused with `409`.** This drive does not replace files:
  the same name arrives as a numbered copy, so answering 200 would tell a sync tool it had updated
  a file it had duplicated. Delete it first, or upload under another key. A file stored before
  hashes were recorded has none to compare with, and is refused the same way with its own sentence.
- **Large files go up in pieces**, the way S3 clients send them: the pieces arrive out of order and
  at the same time, and each one is checked against the hash the client signed for before it
  becomes part of the file. Nothing is stored until every piece is in. ⚠ The comparison above
  happens once the pieces are one file — until then there is nothing to compare — so a large file
  that turns out to be unchanged is sent across the loopback and then not uploaded.
- ⚠ **The modification time is not carried across.** A file arrives with the time it was uploaded,
  so a tool comparing timestamps decides an unchanged file has changed and offers it again. That
  now costs nothing: the content is compared and the upload is skipped.
- **A file uploaded from another device can take five seconds to appear**, which is how long a
  file list is reused before it is fetched again.

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

`nmts mcp` is a local MCP server: it runs on this machine, over stdin and stdout, and speaks to
whatever started it. Sign in first (`nmts login`) — it reads the account code this machine already
keeps and never takes one on a command line.

**Claude Code** and **Codex** both add it in one line, and the line is the same:

```
$ claude mcp add nmts -- nmts mcp --out /where/files/should/land
$ codex mcp add nmts -- nmts mcp --out /where/files/should/land
```

**opencode** has no command for it; put this in `opencode.json`:

```json
{ "mcp": { "nmts": { "type": "local", "command": ["nmts", "mcp", "--out", "/where/files/should/land"] } } }
```

Any other client that runs a local MCP server takes the same two things — the command `nmts` and
the arguments `mcp --out <directory>`. Where it wants them written is that client's business.

It offers twenty tools — reading the account (`nmts_whoami`, `nmts_list`, `nmts_usage`,
`nmts_expiring`, `nmts_balance`, `nmts_shares`), fetching (`nmts_get`, `nmts_pull`,
`nmts_receive`), uploading (`nmts_put`, `nmts_push`), rearranging (`nmts_mkdir`, `nmts_move`,
`nmts_rename`, `nmts_mark`, `nmts_trash`, `nmts_restore`) and sharing (`nmts_public_code`,
`nmts_share`, `nmts_unshare`).

What it deliberately does **not** offer, and why each one is out:

- **Credentials and agreements** — signing in or out, making or revoking a key, granting the
  agreements below. Those are yours. A surface that can grant its own permissions has none.
- **The check a person has to pass.** A machine cannot; that is what the check is for.
- **Destroying anything for good** — emptying the trash, erasing a file permanently. Putting
  something in the trash *is* there, because it can be taken back.
- **Rebuilding a lost file list.** It works, but every name it recovers is a placeholder, and you
  should watch that happen rather than read about it afterwards.
- **Writing your recovery files, and fetching the recovery program.** Those exist for the day this
  service is not there, and they are yours to make and to keep.

Nothing it does offer can write outside the directory you name — a model asking for a path that
climbs out of it gets the file's own name inside it, or a refusal. There is nowhere in a tool
declaration to put a path on your disk, which is what keeps that true as tools are added.

The arguments a tool declares are checked before it runs, and a wrong one is refused rather than
guessed at: a `dry_run` sent as the string `"true"` is an error, not a paid upload.

Implemented directly rather than with an SDK, so it adds no dependency.

## Letting an agent decide for itself

By default the tool asks you before anything that has not been agreed to, and an agent driving it
is told not to answer for you. Two settings change that, and both take a flag that says what it is:

```
$ nmts mode                                   # what is set now
$ nmts mode auto --i-accept-the-risk          # the agent judges, and goes ahead
$ nmts mode skip-permissions --i-accept-the-risk   # the agent goes ahead
$ nmts mode off                               # back to asking
```

While one is on, **every command says so** on stderr. That is deliberate: this is the setting that
decides whether anybody is asked before credits are spent, and a setting that stops announcing
itself is one people forget they turned on.

It does not remove the agreements. Spending, wallets, sharing and where the account code may go are
still recorded one at a time, with dates, and `nmts consent` still lists them. What changes is who
may record them — with `skip-permissions` on, an agent doing it on your behalf is what you asked
for; with it off, the instructions it reads say it must not.

## When the connection blinks

A request that could not be made — the connection refused, reset, or never established, which is
what moving between a phone's data and a wifi network looks like — is tried again, with a wait that
grows between attempts, for about twenty seconds before the failure is reported. Nothing is retried
silently: the wait is announced.

What is **not** retried, and why each one is out:

- **A refusal.** The server saying no — wrong key, no credits, not found — is an answer. Asking
  again spends the wait to hear the same thing later.
- **A request that ran out of time.** It already had its thirty seconds, and that deadline exists so
  that an agent running this in a loop is not left waiting.
- ⛔ **A write with no idempotency key.** A request that reached the server and died on the way back
  looks exactly like one that never arrived, and sending it twice can spend money twice. The two
  calls that pay carry a key — the server's promise that a second copy is the same request — and
  those are repeated. Nothing else that writes is.

## Networks

`--network mainnet` or `--network testnet`, or `NMTS_NETWORK`. It is never guessed: the wrong
network looks in a place your files were never stored and answers "not found" rather than "wrong
network". Against the live server the network is already known and the flag is optional; against
any other server it is required.

## Something wrong?

**Write to `nmts@nmts.me`** — a fault, a confusing message, a missing feature, anything that got in
the way. The smallest annoyance is worth an email; most are cheap to fix and invisible from this
end. Say what you ran and what it said.

That address is for **this tool** being wrong. Questions about the service itself, and reports
about content, go through the contact desk on [nmts.me](https://nmts.me).

## Licence

Apache-2.0. The full text is in [LICENSE](LICENSE), verbatim. It moved here from AGPL-3.0-only on
2026-08-30; copies already held under the AGPL stay under it.

**Build on it, ship it, sell what you build with it.** Nothing is asked of you for using the
program; redistributing it carries the licence and copyright notices with it. If you still need
different terms, write to **nmts@nmts.me** and say why — see [LICENSING.md](LICENSING.md).

This repository does not merge outside code, and [LICENSING.md](LICENSING.md) says why. Bug
reports, questions and ideas are welcome.

Copyright © 2026 needmoretruth.

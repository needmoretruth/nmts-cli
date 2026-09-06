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
- **NMTS charges nothing.** Storage is bought from the Walrus network, for a period, from your own
  wallet; nothing is paid to NMTS. Uploads here spend **credits**, which are storage a donation pool
  has already paid the network for (the weekly free trial) — they are not sold. One command,
  `nmts extend`, pays from your own Sui wallet instead, and asks for a separate agreement first,
  because a signed purchase on a public chain cannot be reversed by anyone.

NMTS is built and run by one developer. This tool, the encryption engine and the recovery program
are open source under Apache-2.0; the server and the web app are not published.

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
npm install -g github:needmoretruth/nmts-cli#v0.27.0    # a pinned version
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

`nmts whoami --reveal` prints the account code itself. It is locked until you run `nmts unlock
reveal` once, and asked about on every run; anything that logs your terminal has the code from
then on.

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
| `nmts erase <paths>` | Erase files for good — the server's record and this account's key, trash or not. A typed sentence, the account code beside the key; `--release-storage` also destroys credit-paid storage (locked until `nmts unlock release-storage`) |
| `nmts mkdir <path>` | Make a folder, and any folder above it that is missing |
| `nmts mv <paths> <folder>` | Move things into a folder. `/` is the top of the drive |
| `nmts rename <path> <name>` | Give one thing a new name |
| `nmts star` / `unstar` | Star files, or take the star off |
| `nmts pin` / `unpin` | Hold files at the top of their folder, or let them fall back |
| `nmts label <name> <files>` | Put one label on files. `unlabel` takes it off; `--rename` and `--all` sweep the whole list |
| `nmts on-collision` | What an upload does when its name is already taken |
| `nmts padding [mode]` | How file sizes are hidden on the storage network, and change it for the next uploads |
| `nmts tip [percent\|off]` | A standing share of every WAL payment sent to the developer as a gift (default 0). Setting it needs `nmts unlock donate`; the agreement is asked once |
| `nmts expiring` | Which files run out of bought storage soon, and when |
| `nmts losses` | Storage NMTS bought for you that the daily check could not find on the chain. `--recheck <id>` asks again; `--dismiss <id>` takes a line off |
| `nmts extend <path>` | Buy more storage time for one file — **signs and spends from the wallet** |
| `nmts wallet` | The account's wallet address, and its SUI and WAL balances. Never signs |
| `nmts wallet activity` | The wallet's recent transactions, named only where the chain proves it. Never signs |
| `nmts wallet storage` | The storage resources (size × time) the wallet holds outside any file. Never signs |
| `nmts wallet storage split <id> --size <n>\|--epochs <n>` · `merge <id> <id>` · `transfer <id> <address>` | Cut, join or hand over a storage resource — **signs**, under the wallet unlock (`transfer` needs scope `all`). No file goes with a transfer: size and remaining time only |
| `nmts wallet send <SUI\|WAL> <amount\|max> <address>` | Send coins to an address — **signs and spends from the wallet**. Prints the review; sends only with `--yes` |
| `nmts wallet swap <SUI\|WAL> <amount\|max>` | Swap one coin for the other on DeepBook or Bluefin — **signs and spends from the wallet**. Without `--venue` prints both quotes and stops; swaps only with `--yes` |
| `nmts wallet donate <SUI\|WAL> <amount>` | A voluntary gift to the developer, in either coin — **signs and spends**. Locked until `nmts unlock donate`, and `--yes` every run |
| `nmts wallet hall [--name <name>\|--remove]` | The gift hall of fame; `--name` lists you by a name you choose, signed by your wallet |
| `nmts trial` | What is left of this week's free credits. `trial apply` asks for some |
| `nmts create` | Make a NEW account and print its code once. Nothing can print it again. With no verified key on this machine it makes the code here, prints an address, and waits while a person opens it, types that code and passes the human check — the account exists the moment they finish. `--no-wait` prints the address and stops |
| `nmts verify` | Ask a person to pass the check that opens this account's limits. Only the account holder can: signed in to this account in that browser, or typing its account code there |
| `nmts public-code` | The code other accounts send files to. `--publish` makes it reachable |
| `nmts share <path> <address>` | Give one file to another account — **withdrawing does not recall it**. Locked until `nmts unlock share`; every share stops and `--yes` answers for that one file |
| `nmts shares` | What was shared with this account; `--sent <path>` shows who one file went to |
| `nmts receive <id>` | Download one file somebody shared with this account |
| `nmts unshare <id>` | Withdraw a share you sent, or remove one you were sent |
| `nmts rebuild` | Build a file list from the server's rows, for an account with none |
| `nmts rollback` | Put the previous version of the file list back — locked until `nmts unlock rollback`, `--yes` every run |
| `nmts listfile` | Write this machine's copy of the sealed file list out as a file |
| `nmts recovery-list` | Write the file that finds this account's bytes without NMTS |
| `nmts kit` | Recovery kit: that list **and the account code**, together in one file |
| `nmts recovery` | Download the standalone program that reads files back without NMTS |
| `nmts unlock` / `nmts lock` | What this machine has unlocked; `unlock <key>` opens one (a person, at a terminal), `lock <key>` closes it. `consent` is the older name |
| `nmts mode` | How much an agent driving this tool may decide without asking |
| `nmts support send` | Send a report to the developer — a bug, an error, an idea, a question. `--attach-log` adds the last runs, redacted |
| `nmts support list` / `show <code>` / `reply <code>` | Read the answers, and write back in the same thread |
| `nmts update` | Install the newest published release of this tool |
| `nmts notices` | What NMTS has posted: interruptions, incidents, and the warning before new Terms take effect. `notices <id>` prints one; `--save <id>` keeps it as a dated file |
| `nmts terms` | The Terms of Service in force. `--lang ko` for Korean, `--board` for the message board's terms, `--save` to keep a copy |
| `nmts privacy` | The Privacy Policy in force. `--lang ko`, `--save` to keep a copy |
| `nmts delete-account` | A **person** erases this account's server record — irreversible. Needs the account code and a typed sentence; refused in the auto modes, and under skip-permissions only with `--reason` |
| `nmts accept-terms` | Accept a new version of the Terms after reading it: a person types the versions, or an agent relays them with `--accept-terms <v> --accept-privacy <v> --yes` after asking |
| `nmts key new` | Make an API key for this account with the account code alone — no browser. `--scopes read,write,spend`, `--days <n>`. The key is stored as this machine's credential; `--print` also prints it once |
| `nmts devices` | The devices signed in to this account. `--sign-out <id>` or `--sign-out all` ends one or all of them — needs the account code, locked until `nmts unlock sign-out`, asked every run |
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

`--pay wallet` buys the storage **from the wallet the account code derives** instead of from credits:

```sh
nmts put film.mov --pay wallet --dry-run            # the review: WAL price, tip, fee, balances, days. Signs nothing
nmts put film.mov --pay wallet --epochs 6           # six of the storage network's epochs (default 2)
nmts put film.mov --pay wallet --storage fit        # use a storage resource the wallet already holds, cut to size
```

The order is the safety: the file is planned into the same parts, the chain quotes each part in WAL
and the relay's tip in SUI, the register transaction is dry-run for its fee, both balances are read,
and the review is printed — the term as epochs and as days — before the `wallet` agreement (scope
`storage`) is held against the total and anything is signed. A wallet known to be short is refused
with the two numbers; a balance that could not be read is said as unread, not as zero. Each part
takes two signatures, register and certify; a run that stops partway is finished by running the same
command again, which signs nothing twice. `--storage fit|whole|<object id>` uses a free storage
resource the wallet holds (`nmts wallet storage` lists them) for a one-part file: `fit` cuts it to the
part's encoded size and leaves the rest free, `whole` binds all of it with the file, and the review
says in bytes which. Without `--storage` new storage is bought; the review only mentions what the
wallet holds. The server records the file as stored on the wallet's own storage, and `nmts extend`
can extend it. A wallet-paid upload does not carry the recovery list's storage-network copy,
whichever way the account's switch is set — today only the browser's small-file uploads do. `push
--pay wallet` does the same one file at a time.

`push` uploads a directory and **stops at the first failure**, saying what is already uploaded.
Files whose name is already in the destination are skipped, so running it again is safe. Names
beginning with a dot are left alone unless `--hidden` is given, and symbolic links are not followed.

`nmts padding` shows how file sizes are hidden, and `nmts padding standard`, `nmts padding pow2` or
`nmts padding off` changes it for every device's next uploads (`off` stores the exact size: the
file's length is visible to the network and to anyone who reads the blob, for about 1 % less storage). Anyone can read the size of a piece on the storage
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
chain. It is locked until you unlock `wallet`, which names a scope (`storage`, or `all` for exchanging and
sending too), runs out after at most 30 days, and can carry a ceiling on what the tool signs away —
`nmts unlock wallet --days 7 [--scope all] [--cap-wal 10 --cap-sui 0.1]`. It takes
`--dry-run`, which touches no key. Before the agreement it reads the wallet and dry-runs the transaction: the price, the chain
fee (SUI) and both balances are printed, and a wallet known to be short is refused with the two
numbers rather than signed. `wallet` only reads: the address is derived on this machine, and a balance that could not be
read is reported as unread, not as zero. `wallet address --qr` draws the address as a code a phone
can scan. `wallet activity` lists the newest transactions with the same names the browser gives
them (seal, extend, erase, exchange, send, receive — otherwise "other", never a guess); gifts to the
developer show as sends there, because the tool does not know that address. `wallet storage` lists
the storage resources the wallet holds outside any file — what deleting a file from the network
gives back — and whether each can be used now. `wallet send` moves SUI or WAL to an address: it
reads both balances, judges the address and the amount by the browser's own rules, dry-runs the
transfer for its fee, prints the review with the whole address, and signs only with `--yes` and
under a `wallet` agreement of scope `all`. `max` sends everything that can be sent (SUI keeps a
reserve back for fees); `--fee-cap` puts a ceiling on the fee. A transfer cannot be undone. `wallet swap`
turns SUI into WAL or WAL into SUI on one of the two venues the browser app offers on mainnet,
DeepBook and Bluefin, with the same transaction the browser builds: your wallet signs, the outputs
come back to it, and NMTS is not a party and takes nothing. Without `--venue` it reads both
venues' quotes at the same moment, prints them side by side — what comes out, the venue's fee as
measured from the quote (or "could not be measured", never a guessed figure) — and stops: neither
is a default and the tool recommends neither; any other exchange may be used instead. With
`--venue deepbook|bluefin` it prints the review: the quote, the least it will accept
(`--slippage-bps`, 1 to 5000, default 50), the chain fee from a dry run, `--fee-cap` if given, and
how far the quote sits from the site's reference price when one can be read (said as uncompared
when none can). A slippage under 10 or over 200 bps, a fee cap far from the measured fee, or a
quote more than 3% from the reference price is refused, even with `--yes`; `--accept-extremes`
goes on anyway, and only a person may say it (refused while a mode is on). The swap needs `--yes`
and a `wallet` agreement of scope `all`; the chain gives what it gives, never less than the
minimum, and a swap that would give less fails on chain with the fee spent. On testnet the one
rail is the official Walrus exchange, SUI→WAL only, at the rate read off its object. `wallet donate` is a voluntary gift to
the developer, to the address the server publishes (the same one the wallet screen's card shows).
It is locked until you run `nmts unlock donate`, needs `--yes` on every run, and is outside the
`wallet` unlock and its ceiling. It says, before signing, that the gift is voluntary, buys nothing, is
non-refundable and cannot be undone, and that the transaction id is the only proof. `nmts tip 2.5` makes
2.5 % of every WAL payment (an upload paid by wallet, an extension) a standing gift, sent right after the
payment without a question; `nmts tip off` stops it, and it is outside the `wallet` ceiling.

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
their bytes are still stored, and `nmts rebuild` finds files the list does not name. It is locked
until you run `nmts unlock rollback`, and needs `--yes` on every run.

### When storage goes missing

`nmts losses` lists the storage objects NMTS bought with your credits that the daily check could not find on the chain — the object id and the day a check first missed it. There is no file name: the server cannot pair the two, and NMTS cannot see the file. `nmts losses --recheck <id>` asks the chain again now. `nmts losses --dismiss <id>` takes a line off once you have read it; it asks once (a medium act — in an auto mode, the agent's judgement). The incident stays in a record that names nobody; the same finding is posted on the notice board by day.

### The check a person has to pass

An API key makes the server answer; it does not stand in for somebody being there. While nobody
has checked in lately, the account still works under tighter limits, and a few requests are
refused outright.

```sh
nmts verify --status   # is the check live, and until when?
nmts verify            # prints a short code for the account holder to type at nmts.me, then waits
```

Neither the tool nor an agent can pass the check. It prints the moment the check ends rather than
a number of days, because the window ends on a boundary of the server's own weeks.

## What it stops to ask about

Every act has a tier. **None** (listing, fetching, folders, marks) never asks. **Low** (the trash,
a setting, a report) and **medium** (uploading, publishing the public code, a new key) ask once
per run — y/N at the terminal, or `--yes`. **High** (signing with the wallet, giving another
account a file, revealing or storing the code unsealed) is locked until you run `nmts unlock
<key>` once on this machine, and then still asks on every run. **Ultra-high** (erasing the
account) is a typed sentence. `nmts unlock` lists the keys; each unlock prints what it opens, what
could go wrong and what it does not cover before it asks. `nmts help <command>` prints any
command's document, with its tier at the top.

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

Unlocks and the mode live in the config directory, and a container that is removed takes them
with it. A fresh container lists and downloads freely; an upload asks, so a script passes `--yes`,
and anything locked (the wallet, sharing) needs the config directory kept outside the container
(`-v nmts-config:/config`) where a person unlocked it once. On an image of your own, `NMTS_CONFIG_DIR` moves everything the tool
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
- Starting it asks once (uploads through it spend credits); `--yes` answers for a script. Deleting
  puts a file in the trash.
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

It offers thirty-seven tools: reading the account (`nmts_whoami`, `nmts_list`, `nmts_usage`,
`nmts_expiring`, `nmts_balance`, `nmts_shares`, `nmts_shares_sent`), the wallet's own reads
(`nmts_wallet_activity`, `nmts_wallet_storage`), the signed-in devices (`nmts_devices`), storage the daily check could
not find (`nmts_losses`, `nmts_loss_recheck`), fetching (`nmts_get`, `nmts_pull`, `nmts_receive`),
uploading (`nmts_put`, `nmts_push`, `nmts_padding`), rearranging (`nmts_mkdir`, `nmts_move`,
`nmts_rename`, `nmts_mark`, `nmts_label_rename`, `nmts_unlabel_all`, `nmts_trash`, `nmts_restore`),
sharing (`nmts_public_code`, `nmts_share`, `nmts_unshare`), writing to the developer
(`nmts_support_send`, `nmts_support_list`, `nmts_support_show`, `nmts_support_reply`) and the
documents this service publishes (`nmts_notices`, `nmts_notice`, `nmts_terms`, `nmts_privacy`).

It deliberately does not offer credentials and agreements, the check a person has to pass,
permanent destruction, rebuilding a lost file list or putting the previous one back, or writing the
recovery files — those are yours. Nothing it offers can write outside the directory you name, and a wrong argument is refused
rather than guessed at. It is implemented directly, with no MCP SDK dependency.

## Letting an agent decide for itself

By default the tool asks you before every act above the lowest tier, and an agent driving it is
told not to answer for you. Four modes, switched only by a person at a terminal:

```
$ nmts mode                        # what is set now
$ nmts mode explain auto-high      # what a mode does, what it risks, what it gains
$ nmts mode auto-low               # low acts run unasked; medium ones are the agent's judgement
$ nmts mode auto-high              # the same, and the agent is asked to think further ahead
$ nmts mode skip-permissions       # nothing asks and nothing is locked — a typed sentence to turn on
$ nmts mode default                # back to asking
```

High acts stay locked in every mode but skip-permissions, and still ask every time once unlocked;
erasing the account is refused in both auto modes. While a mode is on, every command says so on
stderr. An agent may recommend a mode, with the explanation; it cannot switch one.

## Networks and retries

`--network mainnet` or `--network testnet`, or `NMTS_NETWORK`. Against the live server it is
already known; against any other server it is required, because the wrong network answers
"not found" rather than "wrong network".

A connection that was refused, reset or never made is retried with a growing wait for about
twenty seconds, and the wait is announced. A refusal from the server, a request that ran out of
its thirty seconds, and a write without an idempotency key are not retried: the two calls that pay
carry such a key and are safe to repeat, nothing else that writes is.

## Something wrong?

Send it from the tool: `nmts support send --category bug --message "…" --attach-log`. It reaches
the one developer who builds NMTS, in the same inbox as the app's contact form, and the reply comes
back to the same thread (`nmts support list`, then `nmts support show <code>`). The tool shows you
exactly what will be sent before it goes; your account code, API key, passphrase and file contents
are stripped on this machine first, and `--omit <text>` strips anything else you name. English is
preferred; Korean is read too. Ideas count as much as faults, and so does anything you are not sure
about.

If the tool itself cannot run, write to **nmts@nmts.me** with what you ran and what it said.

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

# Changelog

Each version's entry is what changed for the person or the program using `nmts`. The product's own
update history, which covers the site and the server too, is at https://nmts.me/updates.

## 0.47.0 — 2026-09-27

- **Public links.** `nmts link make <path>` makes a link to one file that anyone can open without
  an account, and prints it. The file's key travels in the part after `#`, which no request
  carries. `--hide-name` leaves the name out and `--expires <n>d` ends the link after 1 to 3650
  days. `link list <path>` prints every link to that file with its download count, `link revoke
  <id>` cuts one, and `link open <link>` downloads and checks a file from a link without logging
  in. `make` sits behind the same unlock as `share`. See `nmts help link`.
- **Up to three public codes.** Every code comes from the one NMTS key at a number.
  `nmts public-code list` shows them all, live and revoked, with what went through each;
  `public-code new` publishes the next one (`--replace <n>` revokes one in the same request); and
  `public-code revoke <n>` revokes one for good, asking every time. `share`, `handover make` and
  `public-code --save` take `--as <n>` to use a code other than the lowest-numbered live one.
- **NMTS Heavy on nmts.me.** nmts.me switched Heavy on, paid with credits. Its `--pay wallet`
  payment is still off and answers `heavy_wallet_pay_off`; `--pay evm` works as before.

## 0.46.0 — 2026-09-27

- **NMTS Heavy.** `nmts put --tier heavy` and `nmts push --tier heavy` keep each part of a file whole
  in two separate places on Filecoin instead of spreading it across Walrus storage nodes. Paid with
  credits, each part costs half the Standard credits, rounded up and at least one, and the file is
  kept 28 days. `get`, `pull` and `receive` open Heavy files from their recorded Filecoin copies,
  `ls --long` has a tier column, and the recovery list records Heavy parts so `nmts-recovery` can
  read them. A server that has not switched Heavy on answers `heavy_unavailable` before anything is
  charged; nmts.me has not switched it on yet.
- **Paying Filecoin yourself.** `nmts heavy wallet` shows the EVM wallet your NMTS key derives
  (NCF-3 §1.9), its FIL and USDFC, and its Filecoin Pay deposit. `nmts heavy fund <USDFC>` deposits
  into Filecoin Pay. `put --tier heavy --pay evm` then pays the storage providers from that deposit,
  with `--copies` (1 to 12, default 2) and `--providers` choosing where; it does not go through
  NMTS's treasury. See `nmts help heavy`.
- **Empty files:** `put` and `nmts s3` store an empty file on NMTS Standard instead of refusing it.
  `push` still skips empty files, and `--tier heavy` refuses one.
- **`nmts s3`:**
  - A range is read from the stored part it starts in. Each range used to be decrypted from the
    file's first byte, so a client fetching a 1 GB file in 8 MiB ranges read about 64 GB and the
    late ranges timed out.
  - A large upload is no longer cut after five minutes. The connection closes only when the body
    stops arriving for two minutes, and a request sent with `Expect: 100-continue` is refused
    before its body when its signature or bucket is wrong.
  - Presigned URLs work, and every `aws-chunked` body form is decoded with each chunk signature and
    checksum checked. A request whose signature leaves out `host` or an `x-amz-` header is refused.
  - A listing without a delimiter shows folders as `folder/` markers of 0 bytes, and a `PUT` of
    `folder/` with no bytes makes one.
  - Refusals are answered with the S3 codes clients act on (`AccessDenied`, `AccountProblem`,
    `OperationAborted`, `InvalidRequest`, `NotImplemented`, `SlowDown`) and one fixed sentence each;
    the details go to the log line. Before, most became a `500` the client retried.
  - Served files carry `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`, and a
    signed link can set the type and disposition with `response-content-type` and
    `response-content-disposition`.
  - `CompleteMultipartUpload` and `CopyObject` answer at once and keep the connection alive while the
    file is stored. A batch delete that puts a condition on one of its keys is refused.
- Uploading the same bytes to the same place a second time is a new upload with its own keys. It
  used to rebuild the first upload's keys, so each reservation was refused and a wallet-paid second
  run was answered with the first file.
- For programs: a library call that says whether to rename or overwrite is taken as the program's
  choice; `null` means the machine's setting. Upload refusals carry the server's code, status and
  `Retry-After`, and a wallet known to be short is refused with the code `WALLET_SHORT`.

- **Handover files.** `nmts handover make <path> --to <public code | public code file>` writes one
  file of your drive into a handover file sealed to one recipient, which you pass on yourself; no
  share is registered. `nmts handover open <file>` opens it with your NMTS key, needs no API key,
  asks the NMTS server nothing and fetches the pieces from Walrus aggregators. A handover cannot be
  taken back: the recipient can download the file until its storage ends or its stored bytes are
  destroyed, and removing the file from your drive does not stop it. The format is NCF-3 §5.6.
- **Public code files.** `nmts public-code --save [file]` writes your public code and the identity
  behind it (`nmts-public-code-<code>.nmtscode` by default). Someone who has it can make a handover
  file for you without looking your code up, so NMTS does not learn who is sending to you. It proves
  only itself: compare the code it shows with the one you were given. The format is NCF-3 §5.7.
- `nmts receive <id>` without `--out` now saves into the current directory under the last segment
  of the name the sender sealed. A name such as `../x` or an absolute path used to be written where
  it pointed.
- A download refuses a stored piece whose header names a different position than the one it was
  listed in, as NCF-3 §4.1 requires.
- `nmts erase` says that anyone you gave a handover file to can still open the file until its
  storage ends or its stored bytes are destroyed.
- The local run log no longer writes down `--to` or the public code a recipient lookup asked for.
- Download errors no longer speak of "this account" where the reader may be a recipient.

## 0.45.0 — 2026-09-24

- **Video preview pictures.** `nmts put <video> --thumbnail` takes one frame with ffmpeg, when it is
  on your PATH, and uploads it beside the video as an ordinary small file linked to it; without
  ffmpeg the video goes alone and `nmts` says why. `--thumbnail-file <picture>` hands in a picture
  you made yourself. The picture is priced, encrypted and paid for like any other file.
- `nmts get <video> --thumbnail` fetches the picture instead of the video.
- `nmts ls --media` lists one kind of file. A preview picture is listed on its own only when its
  video is gone.
- Moving a video to the trash, restoring it and erasing it take its picture with it.
- The MCP tools take the same options.

## 0.44.0 — 2026-09-23

- **Recovery phrase.** An NMTS key can be written as 15 words from the BIP-39 English or Korean word
  list. `nmts whoami --reveal --phrase` prints them (`--lang ko` for Korean), and every place that
  takes an NMTS key takes the phrase too. The phrase is the key in another form: it opens the
  account exactly as the key does. For programs, `phraseOf` in `@needmoretruth/nmts-cli/portable`.
- **AI accounts from the terminal.** `nmts ai-account list`, `nmts ai-account create` and
  `nmts ai-account delete` run on the NMTS key's proof; an API key cannot call them. Deleting asks
  you to type the confirmation back, and `--yes` answers it for an agent.
- `nmts put --pay wallet --from <path>` takes a file that credits paid for, downloads and decrypts
  it into this tool's own directory, encrypts and uploads it again paid from your wallet, and moves
  the old file to the trash. Storage the treasury bought cannot be handed to a wallet, so this is a
  new upload, not a transfer.
- The standing gift address is fixed per network in the tool. A self-hosted server that names a
  different one is followed only with `--trust-server-tip-address`; without it, `nmts` stops before
  signing.
- The upload review tells an account that asked for the recovery list's storage-network copy that
  this upload does not carry it, and how to write the list out as a file instead.
- Erasing a folder completely also removes the empty folders under it, which used to stay behind
  in the list with nothing able to open them.
- Reads try a second aggregator on each network when the first cannot be reached.
- `examples/podman.sh` runs the tool in rootless Podman with the key handed in as a secret.

## 0.43.0 — 2026-09-20

- Nothing changes for the `nmts` command: it signs with the wallet this NMTS key derives, as it
  always has, and a terminal has no browser extension to offer instead.
- The library surface has a new entry, `@needmoretruth/nmts-cli/wallet-sign-external`: a program can
  pay for an upload, an extension or a change to a storage resource with a wallet it holds no key to
  — a browser extension, a hardware wallet, a remote signer — by handing over the payer's address and
  a function that signs transaction bytes. The transactions are the same builders the key's own
  signers use, this package submits them and reads the effects rather than trusting a digest, and a
  wallet that declines is `WALLET_REFUSED`.
- A wallet-paid upload and an extension take that payer before they read a balance
  (`WalletPutContext.payer`, `ExtendPlanSeams.payer`), so the quote, both balances, the measured
  chain fee, the review and the sentence saying where to send coins all name the wallet that will
  sign. Without a payer every one of them is the wallet this key derives, unchanged.
- An unfinished wallet-paid upload records which wallet paid, and a later run that would pay from a
  different one is refused before it signs: what a registration creates belongs to the address that
  signed for it.

## 0.42.0 — 2026-09-20

- Nothing changes for the `nmts` command. The library surface gains one seam for programs built on
  it: a caller can name the upload relay, the Sui nodes and the aggregators, and hand over the
  `fetch` function every request goes through (`@needmoretruth/nmts-cli/portable`: `useReach`). The
  command reads its addresses from the environment as before and sets none of it.

## 0.41.0 — 2026-09-20

- **Wallet login.** `nmts login --wallet --sui-key-file <file>` signs in with a Sui wallet, and
  `nmts create --wallet …` makes an account and attaches the wallet to it. The account keeps its NMTS
  key; a copy of it sits on the NMTS server, locked so that only the wallet's signature of one fixed
  message opens it. `nmts openers`, `nmts openers add` and `nmts openers remove <locator>` list,
  attach and take off the wallets that open an account. `--account <n>` and `--app <name>` are inside
  the signed message. The wallet's key is never an option value.
- Attaching asks the wallet to sign twice and refuses unless the signatures match; a zkLogin, a
  multi-signature and a passkey account are refused by name. An attached wallet opens every file in
  the account until it is removed, and removal counts from then on.
- One wallet and one account number open one account. A wallet that already opens an account under
  that number is refused before anything is made or stored (`WALLET_OPENS_ANOTHER_ACCOUNT`), and
  `--account <n>` picks another number.
- The library surface has a new entry, `@needmoretruth/nmts-cli/openers`.

## 0.40.0 — 2026-09-20

- The library surface has a new entry, `@needmoretruth/nmts-cli/storage-control`: what `nmts extend`
  and `nmts wallet storage` (the listing, `split`, `merge`, `transfer`) do, without the prompts or the
  printing. The commands are unchanged: the same reviews, the same `--yes`, the same unlock, the same
  exit codes. `nmts-sdk` 0.6.0 is built on it.

## 0.39.0 — 2026-09-20

- The library surface has a new entry, `@needmoretruth/nmts-cli/drive-erase`: what `nmts erase` does,
  without the prompt or the printing, so a program can erase files for good with the same order of
  operations. `nmts erase` is unchanged: the same sentence to type, the same output, the same exit
  codes. `nmts-sdk` 0.5.0 is built on it.
- A delegation token can carry a fifth scope, `files_erase`. The server still asks for the NMTS
  key's own proof on the two erase requests.

## 0.38.1 — 2026-09-20

- The folder and trash functions behind `@needmoretruth/nmts-cli/drive-edit` no longer import
  `node:crypto`, so a browser bundle that reaches them builds again; the browser entry of `nmts-sdk`
  does. Nothing a command prints has changed.
- `AGENTS.md` has a new section, "What is built on it today": storage for an agent, encrypted
  storage inside a product through the SDK, the S3 endpoint, and recovery without NMTS.

## 0.38.0 — 2026-09-19

- The library surface has a new entry, `@needmoretruth/nmts-cli/s3-gateway`: the S3 server `nmts s3`
  runs, taking a function that says which drive a bucket name means and a list of key pairs that
  may each be held to named buckets, so a program can put it in front of more than one account and
  mount it in a server of its own. `nmts s3` is unchanged: the same output, the same bucket, the same
  refusals. `nmts-sdk` 0.4.0 is built on it.

## 0.37.0 — 2026-09-19

- The library surface has a new entry, `@needmoretruth/nmts-cli/drive-edit`: the list edits behind
  `mkdir`, `mv`, `rename`, `rm` and `restore` as functions that print nothing and refuse with a
  `code` (`NOT_FOUND`, `NAME_TAKEN`, `BAD_NAME`, `NOT_IN_TRASH`, `INTO_ITSELF`). The commands call the
  same functions and print what they printed before. `nmts-sdk` 0.3.0 is built on it.
- Six command documents called the NMTS key "code", the name it had before; `nmts help extend`
  carried an empty code block.

## 0.36.3 — 2026-09-19

- `--help` had the `--on-collision` lines in the middle of the `--part-size` description, so the
  second half of that description read as part of the other option. The two are separate again.

## 0.36.2 — 2026-09-19

- On Windows, `platform keygen` now restricts the key file instead of only reporting that no file
  mode applies: it removes the permissions inherited from the folder and grants your account
  alone (`icacls`). The file is written wherever the command runs, which may be a shared folder.
  If that step fails the command says so and the file is still written.
- Three filler words are gone from the advice printed by `share`, a resumed upload and a wallet
  agreement that asks for too long a term.

## 0.36.1 — 2026-09-19

- On Windows, `platform keygen` says that the key file inherits its folder's permissions, because
  Windows applies no POSIX file mode. 0.36.0 was tagged but not published to npm: its test suite
  asserted the mode on Windows.

## 0.36.0 — 2026-09-19

- `wallet swap`, `wallet storage split|merge|transfer` and `wallet hall` sign from the wallet that
  pays, like every other paying command. Each resolves the wallet's number before it derives an
  address, prints the number beside the address in the review, and takes `--wallet <number>` for one
  run. If the file list cannot be read they refuse rather than falling back to wallet 0.
- `nmts platform keygen [--out <file>]` makes the Ed25519 signing key pair a business registers
  with NMTS Platform. The file is written with mode 0600 and an existing file is never overwritten.
  `nmts platform register` prints where registration happens (the browser, under Settings ›
  Developer › Platform) and exits 2, because registering needs the account's own key.
- Library: the package runs in a browser page. The five things only Node can do (loading the engine,
  keeping state, reading the environment, reporting progress, zstd) sit behind one registered host:
  `nmts` registers the Node host, `nmts/portable` imports nothing from Node, and `nmts/host` is the
  contract a page fills. State is asynchronous on both hosts; the Node host keeps the file names
  earlier versions wrote.
- Library: `generateBusinessKeys`, `signBusinessRequest`, `mintDelegation` and `rotationProof` — a business signs its
  own requests (`nmts_bs1_…`, with a 16-byte nonce so two identical requests in the same second are
  two requests) and signs a delegation (`nmts_dt1_…`) that lets one of its users' devices act within
  a scope for up to 30 days. These are what the SDK's `Nmts.business` is built on.

## 0.35.0 — 2026-09-16

- Many wallets from one NMTS key. The key derives a wallet at every number from 0 upwards, and one
  of them pays. `wallet list` scans the numbers in order, shows each wallet's address and balances,
  marks the one that pays, and stops after twenty unused wallets in a row. `wallet use <number>`
  moves which one pays; the number is kept inside your sealed file list, so the browser, this tool
  and every other device agree on it. `wallet address --index <number>` derives any of them offline.
- Paying commands (`put --pay wallet`, `push --pay wallet`, `wallet send`, `extend`, `wallet donate`)
  sign from the wallet that pays, and `--wallet <number>` pays from another one for that run only.
  If the file list cannot be read they refuse rather than falling back to wallet 0.
- Library: `walletPut` — the wallet-paid upload without the terminal (plan, quote, dry-run the fee,
  read both balances, refuse a shortfall before any signature, sign, upload, record) — plus
  `discoverWallets`, `activeWalletOf`, `walletCountOf`, `hasHistory` and `walCoinType`, for the SDK
  and other programs built on this package.
- Not yet on the paying wallet: `wallet swap`, `wallet storage split|merge|transfer` and `wallet hall`
  still sign from wallet 0; a later version moves them together with the review they print.

## 0.34.4 — 2026-09-07

- The advice for `SPONSORED_IDEM_MISMATCH`: the server now refuses a credit reservation repeated
  under the same key with a different blob (the piece was re-encrypted after it was reserved).
  Repeating the call cannot work; the advice says to start the upload again so new keys are
  derived, and that nothing was charged for the refused call.

## 0.34.3 — 2026-09-07

- Security. `nmts wallet swap` on Bluefin now calls only the contract package pinned in this
  release. Before, it read the "current" package from a public Sui node and preferred that answer,
  so a node giving a false answer could have sent the swap into someone else's code with your coin
  as the argument. The pinned package is still checked against the chain before a quote is shown;
  if that check refuses it, the Bluefin venue is unavailable until a release bumps the pin. DeepBook
  was never affected. No such node was observed and no loss is known.

## 0.34.2 — 2026-09-07

- The README and the agent document open with what the name stands for — NMTS is
  NeedMoreTruthStorage — who builds it, and the site, https://nmts.me; the package description
  says the same. No behaviour changed.

## 0.34.1 — 2026-09-07

- The advice printed for `MANIFEST_TOO_LARGE` no longer tells a program to ask the operator for a
  higher ceiling. The file list is stored in chunks and the room an account has for it grows with
  the files the storage network has confirmed; nobody raises it by hand. The advice now says to
  save once more so an old single-piece list becomes chunks, after which the ceiling is that
  allowance (`details.allowed` on `MANIFEST_CHUNKS_EXCEEDED`).

## 0.34.0 — 2026-09-07

- `nmts credits transfer --to <account identifier> <credits>` moves credits from this account to
  another account of the same family — the account a person made, and every account made under it.
  Nothing reaches anyone else: a recipient outside the family and an account that does not exist
  are refused in the same words. The free trial's one place a week belongs to the whole family, so
  this is how the credits get to the account that needs them. Both balances come back, `--json`
  carries them, and there is an `nmts_credits_transfer` MCP tool. It is a medium act and needs the
  account's human check, like the trial; the credits keep the expiry they already had.

- `nmts balance` opens with `AI account (not the main account)` when the account it is signed in
  to was made under somebody else's for an AI to work in. Such an account has its own NMTS key,
  its own wallet and its own drive, and nothing said which kind you were holding. `--json` and the
  `nmts_balance` MCP tool carry the same fact as `ai_account`; an ordinary account sees nothing.

## 0.33.0 — 2026-09-06

- The secret that opens an account is now called your **NMTS key**. It was the account code; only
  the word changed, and the wallet it derives is the **NMTS key wallet**. Help text, error
  messages, the MCP tool descriptions and the documentation say the new name.
- **Nothing you have scripted breaks.** The flags, the environment variables
  (`NMTS_ACCOUNT_CODE`, `NMTS_ACCOUNT_CODE_FILE`), the config keys, the MCP tool and argument
  names, the error codes and every file format keep the names they already had.

## 0.32.0 — 2026-09-06

- The file list is saved in pieces. Editing one file now uploads the piece it is in instead of the
  whole list, so a rename costs the same on a drive of ten files and a drive of fifty thousand.
  Nothing about the drive changes and there is nothing to do: the first save after this version
  converts the account, and the pieces are kept on this machine by name so a later read fetches
  only what changed. `nmts listfile` writes the index and its pieces out as one file, as before.
- Node 22.15.0 or newer is now required (it was 22). That is the release where Node's own `zlib`
  learned zstd, which is what the pieces are compressed with.

## 0.31.0 — 2026-09-06

- The credit deposit is now a choice: `nmts deposit [credits]` reads and sets what this account
  sets aside per credit-paid file (0 to 64, default 64), and `put --deposit <n>` / `push --deposit
  <n>` set it for one run. `0` sets nothing aside, and a release of that file costs twice the fee
  from the balance instead.
- `nmts balance` names the default and the ceiling the server states, and what each file with a
  deposit set aside and has spent; `nmts erase --release-storage` says what the release cost and
  whether it came out of the deposit, and refuses with both numbers when the balance cannot cover
  a doubled fee.

## 0.30.0 — 2026-09-06

- The package now declares its MCP server for the official registry (`server.json`, `mcpName`),
  so `nmts mcp` can be listed there once the package is on npm.
- `homepage` points at https://nmts.me; this changelog appears on every release page.

## 0.29.0 — 2026-09-06

- The key table gained the sub-account root (bytes 256 to 288 of the derived block), the parent of
  every account code derived under an account. The tool's own commands are unchanged.

## 0.28.0 — 2026-09-06

- `nmts trial apply` asks for the weekly free trial from a terminal, with a key whose four-week
  human check is live.

## 0.27.0 — 2026-09-06

- A rebuilt file list checks each recovered key against its own file before keeping the pair;
  a pair that does not verify keeps its entry and loses its key, and the tool says so.

## 0.24.0 to 0.26.0 — 2026-09-06

- `nmts key list` and `nmts key revoke`: keys are listed and revoked with the account code, never
  with another key.
- `nmts padding off`: files can be stored at their exact size, with the cost written where it is chosen.
- `nmts support`: a question to the operator from the terminal, with an optional redacted run log.
- `nmts create`: an account code made on this machine and a one-time link to finish in a browser.
- The standing share of every WAL payment as a gift, and the hall of fame it feeds.
- Storage resources reshaped and handed over from the terminal, signed under the wallet unlock.
- Files erased for good from the terminal, with the account code's proof beside the key.

## 0.23.0 — 2026-09-06

- Every act is gated by its risk tier and the mode the person set, before the command loads; the
  same table is carried into the MCP tool listing.
- One agent guide per command, read when the command is used.
- The account can be erased from the terminal.

Earlier versions: https://nmts.me/updates

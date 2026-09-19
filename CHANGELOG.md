# Changelog

Each version's entry is what changed for the person or the program using `nmts`. The product's own
update history, which covers the site and the server too, is at https://nmts.me/updates.

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

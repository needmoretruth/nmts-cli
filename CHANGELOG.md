# Changelog

Each version's entry is what changed for the person or the program using `nmts`. The product's own
update history, which covers the site and the server too, is at https://nmts.me/updates.

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

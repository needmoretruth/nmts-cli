# nmts ls — list the files

Commands: ls, listfile
Tiers: ls=none · listfile=none

`nmts ls` lists the account's files. `--json` prints one object: `{state, seq, entries: [{id, path,
kind, size, updatedAt, trashed, trashedAt}], hiddenTrashed, firstTimeOnThisMachine,
serverSeqDisagreed}` — parse that, not the table. Trashed entries are omitted unless `--all`, and
`hiddenTrashed` says how many; do not report a file as gone without checking. `--find <text>`
keeps only names containing the text, `--sort name|size|date` and `--desc` order the listing.

It refuses rather than lists when the server offers a file list older than one this machine has
already seen, or a different list at the same version. Report that and stop; it is not transient.

`nmts listfile` writes this machine's copy of the sealed file list out as a file (`--out`, or
`--out -` for stdout). It is sealed: without the NMTS key it says nothing.

`--media image|video|audio` keeps only files of that kind, judged by the name's extension. A
video's preview picture is never a line of its own while its video is in the list: fetch it with
`nmts get <video> --thumbnail`. It goes to the trash, comes back and is erased with its video. A
picture whose video is gone is listed like any file, so it can still be deleted.

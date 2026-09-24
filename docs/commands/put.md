# nmts put — encrypt one file and upload it

Commands: put
Tiers: put=medium · put.wallet=high(wallet)

`put` spends credits: one per started mebibyte, and the price is printed before the upload
starts. In the default mode it asks first (answer at the terminal, or run with `--yes`);
in an auto mode it runs when you judge it is what the person wants.

```sh
nmts put report.pdf --dry-run      # says the price, sends nothing, charges nothing
nmts put report.pdf --to notes     # into a folder that already exists
nmts put report.pdf --name x.pdf   # under another name
nmts put report.pdf --json         # one JSON object, no progress output
```

A file larger than one part (64 MiB by default, `--part-size` changes it) is split and each part
is bought separately; a run that stops partway is finished by running the same command again, which
buys only what was never bought. If `put` fails, read whether the message says the account has
already paid: when it has, the same command finishes the job for nothing more; when it has not,
nothing was spent. `CHAIN_UNCERTAIN` is the one refusal where retrying can pay twice — run
`nmts ls` and look for the file first.

A name already taken in that folder is decided by this machine's setting (`nmts help on-collision`).
The default numbers the new file and leaves what is there alone.

**`--pay wallet`** buys the storage from the wallet your NMTS key derives instead of from
credits, and signs. It is a standing choice: locked until a person runs `nmts unlock wallet` (scope
`storage` is enough), and asked nothing afterwards while that unlock lasts. Before anything is
signed it prints the review: the WAL price, the relay's tip in SUI, the chain fee measured by a dry
run (`null` in `--json` when it could not be measured, never 0), both balances, and the term
(`--epochs`, default 2). A wallet short of either exits 4 with the two numbers. `--storage
fit|whole|<object id>` uses a free storage resource the wallet holds for a one-part file: `fit`
cuts it to size and leaves the rest free, `whole` binds all of it with the file. Do not choose
`--storage` for the person: the leftover is their decision. `--epochs` and `--storage` without
`--pay wallet` exit 2.

**`--thumbnail`** on a video also sends one frame of it as `<saved name>.thumb.jpg`: an ordinary
small file, priced, sealed and paid for like any other, linked to the video so every app shows it
as the video's tile. The frame is taken by `ffmpeg` (one second in, 512 px on the long side);
`--thumbnail-file <picture>` sends that picture instead. Without `ffmpeg` the video is still stored
and the output says why it went alone. `--dry-run` prices both. With `--json` the one object is
the video's, with the picture's result under `thumbnail` (`{"skipped": "<why>"}` when none went).
On a file that is not a video the flag sends nothing more.

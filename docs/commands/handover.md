# nmts handover — hand one file to one account outside NMTS

Commands: handover
Tiers: handover=none · handover.make=high(share)

`handover make <path> --to <public code | public code file>` writes a handover file: one file of
your drive, sealed so that only the recipient's NMTS key decrypts the file inside it. You pass the
handover file on yourself — mail, chat, a USB stick. No share is registered, and the recipient's
side asks the NMTS server nothing. `--out <file>` names the handover file (default
`nmts-handover-<YYYY-MM-DD>.nmtshandover` in the current directory, the date in UTC; it never
carries the file's own name); `--force` replaces a file that is already there. Both are checked
before anything else is done. The handover file is written readable by you only (mode 0600).

The recipient is either a public code, which is looked up on the server the way `share` looks it
up — so the server sees whom this account looked up — or the path of their public code file
(`nmts public-code --save` on their side), which is not looked up at all. A public code file is
believed only when the identity inside fingerprints to the code it names; that proves the file is
consistent, not that it came from the recipient, so compare the code it shows with the one they
gave you.

It gives another account this file, so it sits behind the same unlock as `share` and asks on every
run: it prints the file, the recipient and the output path and stops until the same command is run
with `--yes`, in every mode but skip-permissions. The command it prints keeps every option you gave.

A handover cannot be taken back. The recipient can download the file until its storage ends or its
stored bytes are destroyed. Removing the file from your drive (`rm`, `erase`) does not stop it.

`handover open <file>` opens a handover file with this account's NMTS key and saves the file it
carries. Without `--out` it is saved in the current directory under the name the sender gave it,
reduced to its last segment; `--out <file>` saves it at that path instead, as `receive --out` does.
It needs the NMTS key and no API key, fetches the pieces straight from Walrus aggregators, checks
each piece's position against its own header and the whole file against the hash the sender
sealed; a file that does not match is not written. It refuses a handover file over 1 MiB, a file
made for another NMTS key, a file whose fields do not hold together, a file from a newer version,
and a file made on the other network (`--network`).

Whoever holds a handover file sees the sender's public code in it. The aggregator the recipient
fetches from sees the recipient's network address, as for any download.

# nmts platform — the key pair a business signs with

Commands: platform
Tiers: platform=none · platform.keygen=medium

`platform keygen` makes an Ed25519 key pair and writes both halves to `nmts-business-key.json`,
or to `--out <file>`, with mode 0600. It refuses a name that already exists, whatever `--force`
says, and prints only the public half. `platform register` cannot register it: that needs a
signed-in browser session at nmts.me, under Settings › Developer › Platform, and the command
prints that path and exits 2.

The private half is what signs every request a business makes and every delegation token it mints
for one of its users. Nothing can derive it again, and replacing the registered key invalidates every
token the old one signed.

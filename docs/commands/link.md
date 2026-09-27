# nmts link — public links to one file

Commands: link
Tiers: link=none · link.make=high(share) · link.revoke=low

`link make <path>` makes a public link to one file of your drive and prints it:
`https://nmts.me/l/<token>#<secret>`. Anyone with the link can open this file. Cutting the link stops
new downloads, but copies already downloaded stay with whoever has them. `--hide-name` leaves the
file's name out; its size stays, because the size is what takes size padding back off.
`--expires <n>d` stops the link after that many days (1d to 3650d); without it the link lasts until
it is cut. The secret after `#` is made here and is in no request: the server stores the file key
wrapped under it, the name document and the content hash sealed under the file key, and a copy of
the secret sealed under this account's key so the link can be printed again. It gives the file to
whoever holds the link, so it sits behind the same unlock as `share` and asks on every run.

`link list <path>` prints every link made to that file, newest first, with when it was made and how
many times it was downloaded; a live link is printed whole again, a cut one says when and by whom
(`owner`, `operator`, `report`).

`link revoke <id>` cuts one link. The server stops handing out the file's pieces for it at once.

`link open <link>` downloads and decrypts a file from a public link, without logging in. It asks
the server for the token only, opens the file key with the secret, fetches the pieces from Walrus
and checks the whole file against the hash the owner sealed; a file that does not match is not
written. Without `--out` the file is saved in the current directory under the name the owner
showed, reduced to its last segment, or `nmts-link-<token>` when the name was hidden; `--force`
replaces a file that is already there. A cut, expired or unknown link is refused.

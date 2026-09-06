# nmts get — fetch one file

Commands: get
Tiers: get=none

Takes the path exactly as `nmts ls` prints it, fetches the sealed parts, decrypts and checks them,
and writes the file. `--out` chooses where. It will not replace an existing file without `--force`
— "already exists" is the person's decision.

It never leaves a half-right file: bytes go to a temporary name beside the target and are renamed
into place only once the hash matches, one part held in memory at a time. `--out -` hands the file
to stdout and writes nothing; in that mode every line for a person, including `--json`, goes to
stderr, binary bytes are refused when stdout is a terminal, and files over 64 MiB are refused
because a pipe cannot be taken back.

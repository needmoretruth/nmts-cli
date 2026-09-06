# nmts login — keep the account code on this machine, and take an API key

Commands: login
Tiers: login=none · login.plain=high(unsafe-code-storage) · login.env=high(plain-env)

`nmts login` stores the account code sealed under a passphrase, checks whichever API key it finds
(`NMTS_API_KEY_FILE`, `NMTS_API_KEY`) with the server, and stores that too. It prints the key's
public handle and never the key. It does not replace a stored key unless the run says so.

Every later command needs the passphrase, from `NMTS_PASSPHRASE` or a terminal. A sealed code with
no passphrase in reach is not a usable credential; `nmts env` says which case this machine is in.

Two other shapes exist and both are locked until a person opens them once, at a terminal:

- `--plain` stores the code unsealed. Unlock: `nmts unlock unsafe-code-storage`.
- `--env` stores nothing and prints the variable to set. Unlock: `nmts unlock plain-env`. The same
  unlock covers reading the code from `NMTS_ACCOUNT_CODE` on every command — an environment
  variable is readable through `docker inspect`, `/proc/<pid>/environ` and most CI logs.

Once unlocked, neither asks again: they are standing choices, not per-run questions.

Prefer `NMTS_ACCOUNT_CODE_FILE=/path` over any of this: the file is read and never copied, it asks
nothing, and it is the shape that works in a container. See `nmts help env`.

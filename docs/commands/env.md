# nmts env: where this is running, and what that means

Commands: env
Tiers: env=none

Needs no credential and contacts nothing. Run it first on a machine you have not seen. `--json`
gives the same thing to parse. It reports the operating system. Whether this is a Docker or Podman
container and whether root here is root on the host. Whether a file written here can be kept
private (measured, not guessed). Whether there is a terminal and whether a browser could be
opened. Whether an NMTS key and an API key were found and where each came from. If the stored
NMTS key is sealed, whether a passphrase is actually reachable. Which agent left a marker here. And
what the version check last found. The `advice` it returns is written to be repeated to the person
as-is. Do that when something in it is a `warn`.

Codex, Hermes and OpenClaw clear the environment before starting an MCP server, so none of
`NMTS_ACCOUNT_CODE`, `NMTS_ACCOUNT_CODE_FILE`, `NMTS_API_KEY` or `NMTS_PASSPHRASE` survives there.
Store the credentials with `nmts login` instead. An empty `agentHosts` list is what those three
look like, not evidence that no agent is running.

Inside a container, do not put the NMTS key in an environment variable. Write it to a file
and set `NMTS_ACCOUNT_CODE_FILE` to its path: `--secret` mounts, tmpfs and bind mounts all work.

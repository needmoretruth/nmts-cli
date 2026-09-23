#!/bin/sh
# Running this tool in a rootless Podman container, with the NMTS key handed in as a secret.
#
#     sh examples/podman.sh ls
#     sh examples/podman.sh put ./notes.txt
#
# ⛔ THE KEY IS NEVER AN ENVIRONMENT VALUE. `podman inspect` prints a container's whole environment,
#    and so does `docker inspect`; a variable holding the key hands it to anybody who can run
#    either. What the variable below holds is a PATH. The key itself arrives on a tmpfs that Podman
#    mounts for this container alone, and it is not in the image, not in the history, and not in the
#    inspect output.
#
# ⛔ NOTHING HERE NEEDS ROOT. Podman builds, stores the secret and runs the container as the user
#    who invoked it; the image runs as an ordinary user inside that. `sudo` on any line of this file
#    would make the config volume root's and the tool unable to write to it.
#
# ⚠ THE SECRET IS STORED UNTIL IT IS REMOVED. `podman secret rm nmts-key` takes it out again. It
#   lives in the invoking user's own Podman store, readable by that user — the same standing as the
#   file it came from, which is why this is worth nothing if that file is world-readable.
set -eu

# The file on THIS machine that holds the NMTS key. The same variable name the tool reads on a
# machine with no container, so one habit covers both.
key_file="${NMTS_ACCOUNT_CODE_FILE:?name the file holding your NMTS key in NMTS_ACCOUNT_CODE_FILE}"
image=nmts
secret=nmts-key
volume=nmts-config

# Built from the repository this file is in — there is no published image.
podman image exists "$image" || podman build -t "$image" .

# ⚠ Created only when it is not there. `podman secret create` on a name that exists is an error, and
#   a script that swallowed it would keep using a secret made from an older file.
podman secret inspect "$secret" >/dev/null 2>&1 || podman secret create "$secret" "$key_file"

# ⛔ THE CONFIG DIRECTORY OUTLIVES THE CONTAINER, and it has to. Unlocks and the mode live there; a
#    container that is removed takes them with it, so the wallet and sharing would ask again on
#    every run and an upload would be refused in a mode nobody set.
#
# ⚠ `--secret <name>` mounts the value at /run/secrets/<name>. A bind mount reaches the same place
#   — `--mount type=bind,src=$key_file,dst=/run/secrets/nmts-key,ro` — for a host that keeps its
#   secrets somewhere Podman's store is not.
exec podman run --rm \
  --secret "$secret" \
  -e NMTS_ACCOUNT_CODE_FILE=/run/secrets/nmts-key \
  -v "$volume":/config \
  -e NMTS_CONFIG_DIR=/config \
  "$image" "$@"

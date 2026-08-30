# An image for this tool, built from this repository.
#
# There is no image published anywhere. This file is here so that building one is a single command
# rather than a snippet a reader has to copy correctly:
#
#     docker build -t nmts .        # or: podman build -t nmts .
#     docker run --rm nmts --version
#
# ⛔ IT RUNS AS A NORMAL USER, and that is not decoration. This tool writes credentials and refuses
#    to read a credential file other accounts can read, so running it as root inside a container
#    whose files are bind-mounted from a host makes those files root-owned on the host too.
FROM node:24-slim

# ⚠ The install needs the network: two packages come from the registry. Everything else — the
#   compiled program and the encryption engine — is in this repository already, so there is no
#   compiler step and no native build.
#
# ⛔ IT INSTALLS A TARBALL, NOT THE DIRECTORY. `npm install -g <a directory>` does not copy
#    anything: it leaves a symlink pointing back at that directory, so deleting the sources
#    afterwards leaves a command that exists on PATH and cannot run — "executable file not found",
#    from an image that built without a single warning. Packing first makes the install a copy.
COPY . /src
RUN cd /src \
 && npm pack --pack-destination /tmp \
 && npm install -g /tmp/nmts-*.tgz \
 && rm -rf /src /tmp/nmts-*.tgz

# ⛔ THIS DIRECTORY EXISTS SO THAT MOUNTING A VOLUME ON IT WORKS. A named volume takes its owner
#    from the directory already at that path in the image; if the path does not exist, the volume
#    is created owned by root and the unprivileged user below cannot write a single byte into it.
#    That failure reads as "the tool is broken", not as "the volume is root's".
#
#        docker run -v nmts-config:/config -e NMTS_CONFIG_DIR=/config nmts ls
RUN mkdir -p /config && chown node:node /config
ENV NMTS_CONFIG_DIR=/config

USER node
WORKDIR /work

ENTRYPOINT ["nmts"]

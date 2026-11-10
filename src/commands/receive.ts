// `nmts receive <id>` — download a file somebody shared with this account.
//
// ⛔ THE LENGTH COMES FROM THE SENDER, NOT FROM THE SERVER. The number the server holds is
//    bytes-on-the-network: larger than the file by a fixed amount per stored piece, and larger
//    again when the sender rounded the stored size up to hide the true one. Only the sender knows
//    the real length, and they sealed it beside the name. Taking the server's number instead
//    produces a file with padding written into the end of it, and the hash check then refuses a
//    download that was otherwise perfect.
//
// ⛔ AND THE HASH IS THE SENDER'S TOO, sealed under the file's own key. The recipient holds that
//    key and nothing else of the sender's, which is exactly why the check works at all: a storage
//    network that returned different bytes cannot produce a matching hash without the key.

import { resolve } from "node:path";

import { fileSink, stdoutSink } from "../download-sink-node.ts";
import { NmtsError } from "../errors.ts";
import { destinationFor } from "../safe-path.ts";
import { resolveNetwork } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { receiveShare } from "../sharing.ts";
import { processStdout, STDOUT_TARGET, type ByteDestination } from "../stdout.ts";
import { shareAccountOf } from "./share.ts";

export interface ReceiveOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Where to write it. Defaults to the name the sender gave it, in the working directory. */
  out?: string | undefined;
  /**
   * A DIRECTORY to write into, keeping the sender's name — for callers that must not let a name
   * from somewhere else choose a path.
   *
   * ⛔ IT IS NOT `out` WITH A SLASH. `out` is a full path the caller picked; this one says "the
   *    name is theirs, the place is mine", and the name is reduced to its last segment and checked
   *    against this directory before anything opens. A sender who calls their file
   *    `../../.ssh/authorized_keys` has picked a legal name for a file and must not thereby pick a
   *    path on somebody else's disk. Ignored when `out` is given.
   */
  intoDir?: string | undefined;
  force?: boolean;
  /** Where the bytes go when `--out -` was given. Injected so a test can read them. */
  stdout?: ByteDestination;
  json?: boolean;
  write?: (line: string) => void;
}

export async function receive(id: string | undefined, options: ReceiveOptions = {}): Promise<number> {
  const toStdout = options.out === "-";
  const say =
    options.write ?? ((line: string) => (toStdout ? process.stderr : process.stdout).write(`${line}\n`));
  if (id === undefined || id === "") {
    throw new NmtsError("Say which share to receive.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} receive <id>\` — the id \`${BINARY_NAME} shares\` prints.`,
    });
  }
  const session = await openSession({ server: options.server, network: options.network });
  const account = shareAccountOf(session, resolveNetwork(session.server, session.network));
  // ⛔ THE ROW IS FOUND IN THE LISTING, not asked for by id, and the length written is the one the
  //    sender sealed — both inside `receiveShare`, for the reasons at the top of this file.
  let destination: string | null = null;
  const got = await receiveShare(account, id, ({ name }) => {
    destination = toStdout
      ? null
      : options.out !== undefined
        ? resolve(options.out)
        : // ⛔ The name is the SENDER'S choice, so it lands in a directory by its last segment only:
          //    `../x` or an absolute path must not put a file outside where this tool was run.
          destinationFor(options.intoDir ?? ".", name);
    // ⛔ `--force` has nothing to overwrite on the stdout branch and is ignored there on purpose.
    //    On the disk branch the file streams into a temporary name beside the destination and is
    //    renamed into place only once the sender's digest matches, so a share that turns out to be
    //    wrong — or a transfer that stops half way — leaves nothing under the name it was given.
    return destination === null
      ? stdoutSink(options.stdout ?? processStdout())
      : fileSink(destination, { force: options.force === true });
  });
  if (!got.delivered) return 0;
  if (options.json) {
    say(
      JSON.stringify({
        id,
        name: got.name,
        bytes: got.bytes,
        from: got.sender,
        senderRevoked: got.senderRevoked,
        toIndex: got.toIndex,
        parts: got.parts,
        out: destination ?? STDOUT_TARGET,
      }),
    );
    return 0;
  }
  say(`${got.name}  ${got.bytes} bytes`);
  say(`  from ${got.sender ?? ""}${got.senderRevoked ? "  · the sender has revoked this code" : ""}`);
  if (got.toIndex !== 0) say(`  to #${got.toIndex}  ${got.toCode}`);
  say(`  checked against the hash the sender sealed with it`);
  return 0;
}

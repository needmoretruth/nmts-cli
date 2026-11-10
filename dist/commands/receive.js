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
import { fileSink, stdoutSink } from "../download-sink-node.js";
import { NmtsError } from "../errors.js";
import { destinationFor } from "../safe-path.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { receiveShare } from "../sharing.js";
import { processStdout, STDOUT_TARGET } from "../stdout.js";
import { shareAccountOf } from "./share.js";
export async function receive(id, options = {}) {
    const toStdout = options.out === "-";
    const say = options.write ?? ((line) => (toStdout ? process.stderr : process.stdout).write(`${line}\n`));
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
    let destination = null;
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
    if (!got.delivered)
        return 0;
    if (options.json) {
        say(JSON.stringify({
            id,
            name: got.name,
            bytes: got.bytes,
            from: got.sender,
            senderRevoked: got.senderRevoked,
            toIndex: got.toIndex,
            parts: got.parts,
            out: destination ?? STDOUT_TARGET,
        }));
        return 0;
    }
    say(`${got.name}  ${got.bytes} bytes`);
    say(`  from ${got.sender ?? ""}${got.senderRevoked ? "  · the sender has revoked this code" : ""}`);
    if (got.toIndex !== 0)
        say(`  to #${got.toIndex}  ${got.toCode}`);
    say(`  checked against the hash the sender sealed with it`);
    return 0;
}

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
import { request } from "../api.js";
import { loadCrypto } from "../crypto.js";
import { fetchWithKey } from "../download.js";
import { fileSink, stdoutSink } from "../download-sink.js";
import { NmtsError } from "../errors.js";
import { destinationFor } from "../safe-path.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { openReceived, openSharedDigest, shareKeysOf } from "../share.js";
import { processStdout, STDOUT_TARGET } from "../stdout.js";
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
    const chain = resolveNetwork(session.server, session.network);
    const crypt = await loadCrypto();
    const keys = shareKeysOf(crypt, session.code);
    try {
        // ⛔ THE ROW IS FOUND IN THE LISTING, not asked for by id. The listing is what carries the
        //    sender's published identity, and without that identity the envelope cannot be
        //    authenticated — an unauthenticated open is not one worth doing.
        const answer = await request(session.server, "/v1/shares/received", {
            token: session.apiKey,
        });
        const rows = typeof answer === "object" && answer !== null ? Reflect.get(answer, "shares") : null;
        if (!Array.isArray(rows))
            throw new NmtsError("The server did not list any shares.");
        const row = rows.find((candidate) => typeof candidate === "object" && candidate !== null && Reflect.get(candidate, "id") === id);
        if (row === undefined) {
            throw new NmtsError(`Nothing shared with this account has the id "${id}".`, {
                exitCode: 4,
                nextStep: `Nothing was written. \`${BINARY_NAME} shares\` lists what is there.`,
            });
        }
        const opened = openReceived(crypt, keys, row);
        if (opened.dek === null || opened.name === null) {
            throw new NmtsError(`That share ${opened.problem ?? "did not open"}.`, {
                exitCode: 1,
                nextStep: "Nothing was written. The sender can withdraw it and share the file again.",
            });
        }
        if (opened.size === null) {
            // ⛔ NOT A GUESS. Without the sender's number there is nothing to trim the stored bytes back
            //    to, and taking the stored length would write padding into the end of the file.
            opened.dek.fill(0);
            throw new NmtsError("The sender did not record this file's real length.", {
                exitCode: 1,
                nextStep: "Nothing was written. It was shared by an older client; ask them to share it again from " +
                    "a current one, which seals the length beside the name.",
            });
        }
        const expected = openSharedDigest(crypt, opened.dek, opened.digestCt);
        if (expected === null) {
            opened.dek.fill(0);
            throw new NmtsError("This share's content hash did not open with the file's own key.", {
                exitCode: 1,
                nextStep: "Nothing was written. There would be nothing to check the bytes against.",
            });
        }
        const destination = toStdout
            ? null
            : options.out !== undefined
                ? resolve(options.out)
                : options.intoDir !== undefined
                    ? destinationFor(options.intoDir, opened.name)
                    : resolve(opened.name);
        // ⛔ `--force` has nothing to overwrite on the stdout branch and is ignored there on purpose.
        //    On the disk branch the file streams into a temporary name beside the destination and is
        //    renamed into place only once the sender's digest matches, so a share that turns out to be
        //    wrong — or a transfer that stops half way — leaves nothing under the name it was given.
        const sink = destination === null
            ? stdoutSink(options.stdout ?? processStdout())
            : fileSink(destination, { force: options.force === true });
        const fetched = await fetchWithKey({
            base: session.server,
            apiKey: session.apiKey,
            descriptorPath: `/v1/shares/${encodeURIComponent(id)}/parts?for=download`,
            size: opened.size,
            dek: opened.dek,
            expected,
            chain,
            sink,
        });
        if (!fetched.delivered)
            return 0;
        if (options.json) {
            say(JSON.stringify({
                id,
                name: opened.name,
                bytes: fetched.byteCount,
                from: opened.sender,
                parts: fetched.partCount,
                out: destination ?? STDOUT_TARGET,
            }));
            return 0;
        }
        say(`${opened.name}  ${fetched.byteCount} bytes`);
        say(`  from ${opened.sender ?? ""}`);
        say(`  checked against the hash the sender sealed with it`);
        return 0;
    }
    finally {
        keys.wipe();
    }
}

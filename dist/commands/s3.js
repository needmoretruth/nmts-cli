// `nmts s3` — serve this account's drive to any program that speaks S3.
//
// ⛔ WHY THIS EXISTS. Backup programs, sync tools and agent frameworks already know how to talk to
//    S3. They do not know how to talk to this. Rather than ask every one of them to learn, the tool
//    speaks the protocol they already speak, on this machine, where the account code already is.
//
// ⛔ WHAT IT IS NOT. It is not a bridge to the internet and cannot be made into one: the address it
//    binds is loopback and there is no option to change that (`s3/server.ts` says why). Nothing is
//    stored: the access key it prints is made fresh every time it starts and dies with it.
//
// ⛔ READ ONLY, AND IT SAYS SO. Writing costs credits, and spending is one of the three things this
//    tool asks a person about once per machine. Answering PUT before that agreement exists would
//    spend somebody's money because a sync tool decided to. Uploads come next, behind that gate.
import { createWriteStream } from "node:fs";
import { rm as removeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { isGranted } from "../consent.js";
import { fetchFile } from "../download.js";
import { NmtsError } from "../errors.js";
import { ensureFolderPath } from "./organise.js";
import { put } from "./put.js";
import { rm } from "./trash.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { BUCKET } from "../s3/listing.js";
import { BIND_ADDRESS, createGateway, newCredential } from "../s3/server.js";
/** MinIO's port, which is what most S3 tools already have in their examples. */
export const DEFAULT_PORT = 9000;
/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts.
 */
export const LIST_CACHE_MS = 5_000;
function portOf(raw) {
    if (raw === undefined)
        return DEFAULT_PORT;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new NmtsError(`--port needs a number between 1 and 65535, not ${raw}.`, { exitCode: 2 });
    }
    return port;
}
export async function s3(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const port = portOf(options.port);
    const session = await openSession({ server: options.server, network: options.network });
    const chain = resolveNetwork(session.server, session.network);
    const credential = newCredential();
    let cached = [];
    let cachedAt = 0;
    const entries = async () => {
        if (Date.now() - cachedAt < LIST_CACHE_MS)
            return cached;
        const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
        cached = list.manifest === null ? [] : list.manifest.entries;
        cachedAt = Date.now();
        return cached;
    };
    // ⛔ WRITING IS OFF UNLESS THIS MACHINE ALREADY AGREED TO SPENDING. A gateway cannot ask: its
    //    caller is a program and its stdin is not a terminal. So the question is answered before it
    //    starts, and where the answer is no every write says so and nothing is charged.
    const writable = isGranted("spend");
    const server = createGateway({
        credential,
        source: {
            entries,
            ...(writable
                ? {
                    write: {
                        // ⛔ THE BODY IS SPOOLED TO A FILE FIRST, 0600, and deleted whatever happens. The
                        //    upload path reserves storage, cuts parts and seals them from a file, and giving
                        //    it a socket instead would mean either holding whole uploads in memory or
                        //    writing a second upload path — and a second upload path is a second place for
                        //    "what if the reservation succeeds and the part fails" to be got right.
                        put: async (key, body, size) => {
                            const at = key.lastIndexOf("/");
                            const folder = at < 0 ? undefined : key.slice(0, at);
                            const name = at < 0 ? key : key.slice(at + 1);
                            const spool = join(tmpdir(), `nmts-s3-${randomUUID()}`);
                            try {
                                await pipeline(body, createWriteStream(spool, { mode: 0o600 }));
                                if (folder !== undefined && folder !== "")
                                    await ensureFolderPath(session, folder);
                                await put(spool, {
                                    server: options.server,
                                    network: options.network,
                                    ...(folder === undefined || folder === "" ? {} : { to: folder }),
                                    name,
                                    write: () => undefined,
                                });
                                cachedAt = 0;
                            }
                            finally {
                                await removeFile(spool, { force: true });
                            }
                            void size;
                        },
                        trash: async (object) => {
                            await rm([`/${object.key}`], {
                                server: options.server,
                                network: options.network,
                                write: () => undefined,
                            });
                            cachedAt = 0;
                        },
                    },
                }
                : {}),
            // The real reader. The gateway takes it as a function so its own tests can be driven by a
            // real S3 client without an account, a network or anybody's credits.
            fetch: async (object, sink) => {
                const wrapped = object.entry.dekWrapped;
                if (wrapped === undefined)
                    throw new NmtsError("That entry has no key in the file list.");
                await fetchFile({
                    base: session.server,
                    apiKey: session.apiKey,
                    accountCode: session.code,
                    itemId: object.entry.id,
                    size: object.size,
                    dekWrapped: wrapped,
                    contentHashCt: object.entry.contentHashCt,
                    chain,
                    sink,
                });
            },
        },
    });
    await new Promise((resolve, reject) => {
        server.once("error", (error) => {
            reject(error.code === "EADDRINUSE"
                ? new NmtsError(`Port ${port} on ${BIND_ADDRESS} is already taken.`, {
                    exitCode: 4,
                    nextStep: `Nothing was served. Pass --port with a free number.`,
                })
                : error);
        });
        server.listen(port, BIND_ADDRESS, resolve);
    });
    const endpoint = `http://${BIND_ADDRESS}:${port}`;
    if (options.json === true) {
        say(JSON.stringify({
            endpoint,
            bucket: BUCKET,
            accessKeyId: credential.accessKeyId,
            secretAccessKey: credential.secretAccessKey,
            readOnly: !writable,
            listCacheMs: LIST_CACHE_MS,
        }));
    }
    else {
        say(`  This account's drive is being served at ${endpoint}, to this machine only.`);
        say(``);
        say(`  endpoint        ${endpoint}`);
        say(`  bucket          ${BUCKET}`);
        say(`  access key id   ${credential.accessKeyId}`);
        say(`  secret key      ${credential.secretAccessKey}`);
        say(`  region          any — the signature carries whichever one the client used`);
        say(``);
        say(writable
            ? `  Listing, downloading, uploading and deleting all work. Uploading spends credits.`
            : `  ⛔ READ ONLY — this machine has not agreed to spending, so uploads and deletes are` +
                ` refused. \`${BINARY_NAME} consent grant spend\`, run by the person whose account this` +
                ` is, changes that.`);
        say(`  ⚠ Large files are not sent yet: a client switches to a multipart upload above its own`);
        say(`     size threshold, and this gateway refuses those with a message saying so.`);
        say(`  ⛔ These credentials were made for this run and are stored nowhere. They stop working`);
        say(`     the moment this command does.`);
        say(`  ⚠ A file uploaded from another device can take ${LIST_CACHE_MS / 1000}s to appear here.`);
        say(``);
        say(`  Press Ctrl-C to stop. \`${BINARY_NAME} s3 --json\` prints the same thing in one line.`);
    }
    await new Promise((resolve) => {
        const stop = () => {
            server.close(() => resolve());
            // A client holding a connection open must not keep the process alive after Ctrl-C.
            server.closeAllConnections();
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
        void options.until?.then(stop);
    });
    return 0;
}

// `nmts s3` — serve this account's drive to any program that speaks S3.
//
// ⛔ WHY THIS EXISTS. Backup programs, sync tools and agent frameworks already know how to talk to
//    S3. They do not know how to talk to this. Rather than ask every one of them to learn, the tool
//    speaks the protocol they already speak, on this machine, where the NMTS key already is.
//
// ⛔ WHAT IT IS NOT. It is not a bridge to the internet and cannot be made into one: the address it
//    binds is loopback and there is no option to change that (`s3/server.ts` says why). Nothing is
//    stored: the access key it prints is made fresh every time it starts and dies with it.
//
// ⛔ WRITING IS BEHIND THE SPENDING AGREEMENT, AND SAYS SO WHEN IT IS NOT THERE. Uploading costs
//    credits, and spending is one of the three things this tool asks a person about once per
//    machine -- and a gateway cannot ask, because its caller is a program and its stdin is not a
//    terminal. So the agreement has to exist before it starts: without it the drive is served read
//    only and every write is refused with the sentence naming the command that grants it.
import { rm as removeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDriveSource, fetchObject, LIST_CACHE_MS } from "../s3/drive.js";
import { NmtsError } from "../errors.js";
import { ensureFolderPath } from "../drive-edit.js";
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
    /**
     * Where the pieces of a multipart upload wait until they are one file.
     *
     * ⛔ ONE DIRECTORY PER RUN, 0700, REMOVED WHEN THE COMMAND STOPS. Pieces are somebody's
     *    plaintext; leaving them in a shared temporary directory under a predictable name would put
     *    them where any other account on the machine could read them, for as long as the upload
     *    takes and afterwards.
     */
    const stagingRoot = join(tmpdir(), `nmts-s3-${randomUUID()}`);
    // ⛔ THE QUESTION WAS ANSWERED BEFORE THIS STARTED. A gateway cannot ask: its caller is a program
    //    and its stdin is not a terminal. `s3` is a medium act (`risk.ts`) — uploads through it spend
    //    credits — so the tier gate asked at the start, or the mode waved it through, and every write
    //    from here on is what was agreed to.
    const writable = true;
    /**
     * This account, as the shared drive module takes it.
     *
     * ⛔ THE SIX FUNCTIONS ARE THE ONLY THING THIS COMMAND CONTRIBUTES. What an upload DOES — the
     *    same-file verdict, the folders above the key, forgetting the cached list — lives in
     *    `s3/drive.ts`, so that the gateway a business runs from the SDK and the one a person runs
     *    here cannot come to disagree about it.
     */
    const source = createDriveSource({
        stagingRoot,
        writable,
        onAlreadyStored: (key) => say(`same ${key} — already stored, nothing sent`),
        account: {
            readList: async () => {
                const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
                return list.manifest === null ? [] : list.manifest.entries;
            },
            // The command holds the code for its whole run: a person started it and is standing there.
            withCode: (use) => use(session.code),
            makeFolder: async (folder) => {
                await ensureFolderPath(session, folder);
            },
            store: async (path, name, folder) => {
                await put(path, {
                    server: options.server,
                    network: options.network,
                    ...(folder === undefined ? {} : { to: folder }),
                    name,
                    write: () => undefined,
                });
            },
            trash: async (path) => {
                await rm([path], {
                    server: options.server,
                    network: options.network,
                    write: () => undefined,
                });
            },
            fetch: (object, sink) => fetchObject({ server: session.server, bearer: session.apiKey, code: session.code, chain }, object, sink),
        },
    });
    const server = createGateway({
        credentials: [credential],
        // One name, one drive — which is what a bucket is for a person serving their own account.
        bucketOf: (name) => (name === BUCKET ? source : null),
        bucketNames: () => [BUCKET],
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
        say(`  ⚠ A file already in the drive is not replaced: uploading over one is refused, and a`);
        say(`     delete puts the old one in the trash for thirty days.`);
        say(`  ⛔ These credentials were made for this run and are stored nowhere. They stop working`);
        say(`     the moment this command does.`);
        say(`  ⚠ A file uploaded from another device can take ${LIST_CACHE_MS / 1000}s to appear here.`);
        say(``);
        say(`  Press Ctrl-C to stop. \`${BINARY_NAME} s3 --json\` prints the same thing in one line.`);
    }
    await new Promise((resolve) => {
        const stop = () => {
            // Nothing half-uploaded outlives the command that was staging it.
            void removeFile(stagingRoot, { recursive: true, force: true });
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

// The recovery list as a library: build it, record it, and read or flip its storage-network copy —
// for the command line, the SDK, and a page, with nothing in it that needs Node.
//
// ⛔ WHY IT IS ITS OWN ENTRY (spec 2026-09-20 unit B · owner 09-20 D1). An app built on NMTS had no
//    way to hand its user the one file that outlives this service, or to say whether that file
//    rides along on the storage network. `nmts recovery-list` could, and only from a terminal. The
//    command is now a shell over `makeRecoveryList`, so the file an app gets is the file the
//    command writes, byte for byte.
//
// ⛔ THE SAME FOR EVERY KEY HOLDER. `RecoveryAccount.bearer` is an API key or a delegation token,
//    and `accountProof` is the code's proof (`authSecret`, NCF-3 §1). The server asks for both on
//    the three recovery doors whichever credential arrives — a business holding a token cannot
//    rebuild its user's whole index by itself, and nobody holding the code is refused.
//
// ⛔ NO `node:`, NO `Buffer`, NO `process.` — `test/portable-closure.test.ts` walks this file.
//    State goes through `host().state` (`recovery-seq.ts`), bytes through `bytes.ts`.
import { request, ServerError } from "./api.js";
import { artifactAbout } from "./artifact-about.js";
import { utf8 } from "./bytes.js";
import { AAD, DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
import { readFileList } from "./manifest.js";
import { BINARY_NAME } from "./product.js";
import { buildRecoveryList, openRaw, pathString } from "./recovery-build.js";
import { buildRecoveryMapFile } from "./recovery-map-file.js";
import { recoveryDocMeta } from "./recovery-map.js";
import { lastOfferedSeq, rememberOfferedSeq } from "./recovery-seq.js";
import { readAllRecoverySource } from "./recovery-source.js";
import { buildIndex, pathOf } from "./shared/lib/drive/manifest-index.js";
import { AGGREGATOR_HOSTS, suiRpcHost } from "./walrus.js";
const NETWORK_COPY = "/v1/account/recovery-network-copy";
/**
 * The switch as the server holds it, or null from a server older than the narrow read.
 *
 * ⚠ NULL ONLY FOR 404 AND 405 — "this server has no such door". Any other refusal is thrown: a
 *   copy switched on and a read that failed are opposite facts, and folding one into the other
 *   would quietly stop uploads carrying the list.
 */
export async function readRecoveryCopy(account) {
    let reply;
    try {
        reply = await request(account.server, NETWORK_COPY, { token: account.bearer });
    }
    catch (error) {
        if (error instanceof ServerError && (error.status === 404 || error.status === 405))
            return null;
        throw error;
    }
    if (!isRecord(reply) || typeof reply["enabled"] !== "boolean" || typeof reply["written"] !== "boolean") {
        throw new NmtsError("This version cannot read the server's answer about the recovery list's storage copy.");
    }
    const seq = reply["seq"];
    return {
        enabled: reply["enabled"],
        written: reply["written"],
        seq: typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0,
    };
}
/** Turn the storage-network copy on or off. The code's proof travels with it. */
export async function setRecoveryCopy(account, on) {
    await request(account.server, NETWORK_COPY, {
        method: "PUT",
        token: account.bearer,
        accountProof: account.accountProof,
        body: { enabled: on },
    });
}
/**
 * The number the next list carries: one past the higher of the server's and this machine's own.
 *
 * ⛔ BOTH, NOT EITHER. The server's alone repeats a number whose record was swallowed; this
 *    machine's alone repeats one a browser already wrote (`recovery-seq.ts`).
 */
export async function nextRecoverySeq(account) {
    const server = await readRecoveryCopy(account);
    return Math.max(server?.seq ?? 0, await lastOfferedSeq(account.accountId)) + 1;
}
/**
 * Where the bytes this list points at live, for the sealed self-description.
 *
 * ⚠ `aggregators` AND `chain_rpc` ARE HINTS — the first thing in the file to go stale, read by a
 *   reader after its own defaults. `chain` is the one that changes behaviour: a blob id from
 *   testnet and one from mainnet are the same kind of string.
 */
function storageFor(network) {
    return {
        network: "walrus",
        chain: network,
        aggregators: [...(AGGREGATOR_HOSTS[network] ?? [])],
        chain_rpc: suiRpcHost(network),
    };
}
/**
 * Read the account, build its recovery list, seal it, and wrap it as the `.nmtsmap` file.
 *
 * ⛔ THE CAPTURE TIME IS STAMPED BEFORE ANYTHING IS READ. The server keeps it to decide which files
 *    count as "not in your list yet"; stamped after the walk, a file made during the walk would be
 *    in neither the list nor the count.
 *
 * ⛔ THE DATA KEY IS DERIVED HERE AND WIPED HERE, on every path out, including the failing one.
 */
export async function makeRecoveryList(account, options = {}) {
    const capturedAt = new Date().toISOString();
    const list = await readFileList(account.server, account.bearer, account.code, account.accountId);
    // ⛔ A FIRST UPLOAD HAS NO LIST YET, and the file riding with it is then the whole account — the
    //    browser's first upload copies the same one-file list (found 2026-11-10 on testnet).
    const riding = options.riding ?? [];
    if (list.manifest === null && riding.length === 0) {
        throw new NmtsError("This account has no file list, so nothing can be described.", {
            exitCode: 4,
            nextStep: `Nothing was written. A recovery list says what each stored file is CALLED and which key ` +
                `opens it, and both come from the account's own file list. The storage network holds ` +
                `neither. Run \`${BINARY_NAME} rebuild\` if this account has stored files but no list.`,
        });
    }
    const entries = list.manifest?.entries ?? [];
    const source = await readAllRecoverySource({
        server: account.server,
        apiKey: account.bearer,
        accountProof: account.accountProof,
        onProgress: options.onProgress,
    });
    const generatedAt = new Date().toISOString();
    const seq = await nextRecoverySeq(account);
    const crypt = await loadCrypto();
    const derived = crypt.kdf_derive(crypt.account_code_parse(account.code));
    const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
    derived.fill(0);
    let built;
    try {
        const index = buildIndex(entries);
        const pending = riding.map((file) => {
            const parent = file.parentId === null ? undefined : index.byId.get(file.parentId);
            const part = { part_index: 0, plaintext_len: file.size, network: "walrus" };
            return {
                id: file.identifier,
                name: file.name,
                path: pathString(parent === undefined ? [] : [...pathOf(index, parent), parent.name]),
                size: file.size,
                dek: openRaw(crypt, dataKey, file.dekWrapped, AAD.dekWrap, `the key of ${file.name}`),
                contentHash: openRaw(crypt, dataKey, file.contentHashCt, AAD.contentHash, `the content hash of ${file.name}`),
                // This file is being written now, so "now" is its real date; the next list rewrites it.
                createdAt: generatedAt,
                updatedAt: generatedAt,
                parts: [file.streamPlaintextLen > file.size ? { ...part, padded_len: file.streamPlaintextLen } : part],
                quilt: { identifier: file.identifier },
            };
        });
        built = buildRecoveryList({
            crypt,
            dataKey,
            accountId: account.accountId,
            entries,
            source,
            seq,
            generatedAt,
            pending,
            meta: recoveryDocMeta(artifactAbout("recovery-list"), storageFor(account.network)),
        });
    }
    finally {
        dataKey.fill(0);
    }
    const file = buildRecoveryMapFile({
        accountId: account.accountId,
        seq,
        generatedAt,
        // ⛔ READ BACK OUT OF THE DOCUMENT: from NRM-3 on the number depends on what is in it.
        nrm: built.doc.v,
        sealed: built.sealed,
    });
    return { file: { filename: file.filename, content: utf8(file.content) }, built, seq, capturedAt };
}
/**
 * Tell the server a list was written, and what number it carries.
 *
 * ⛔ THE ATTEMPT IS REMEMBERED WHETHER OR NOT IT LANDS (`recovery-seq.ts`): a number the server
 *    refused must not be the number the next run offers again.
 *
 * ⛔ A BLOB ID ONLY FOR A STORAGE-NETWORK COPY. Without one the record says `local`, and the server
 *    refuses an address beside `local` — a recorded address nothing was written to would let a
 *    screen advertise a copy that does not exist.
 */
export async function recordRecoveryList(account, record) {
    await rememberOfferedSeq(account.accountId, record.seq);
    const body = record.blobId === undefined
        ? { kind: "local", seq: record.seq }
        : { kind: "walrus", seq: record.seq, blob_id: record.blobId };
    if (record.capturedAt !== undefined)
        body["captured_at"] = record.capturedAt;
    await request(account.server, "/v1/account/recovery-map", {
        method: "PUT",
        token: account.bearer,
        accountProof: account.accountProof,
        body,
    });
}
/** Note a number as offered before the bytes carrying it leave — skipping one is harmless, reusing one is not. */
export async function noteOfferedSeq(accountId, seq) {
    await rememberOfferedSeq(accountId, seq);
}

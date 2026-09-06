// Reading and writing the file list as an INDEX plus CHUNKS — NCF-3 §6.3, format version 2.
//
// ⛔ THE ONE RULE THIS FILE CARRIES. A chunk that will not arrive, or that arrives with bytes whose
//    hash is not the one the index named, is a list this machine COULD NOT READ COMPLETELY. It is
//    never a shorter list. Every path below refuses by name, because a drive silently missing a
//    chunk's worth of files invites its owner to upload them again — at their own cost, onto a
//    storage network.
//
// ⛔ WHAT THE INDEX PINS, RESTATED AS CODE. The index is authenticated (the envelope), continued
//    (`p`), and names every chunk by the hash of its transport string plus how many entries it
//    holds. So the reader re-hashes what it was handed and counts what it opened: a swapped,
//    dropped, duplicated or rolled-back chunk fails one of those two before an entry is used.
//
// ⛔ THE CHUNKS ARE WRITTEN BEFORE THE INDEX, always. An index naming a chunk the server does not
//    hold would be a version nobody — including this machine — could open afterwards. The server
//    refuses exactly that, and this ordering is why it never has to.
//
// PURE OF COMMANDS: it takes a derived key and a server, and knows nothing about what an edit
//   means. Deciding WHICH entries the list should hold is `manifest-write.ts`'s job; deciding which
//   entry goes in which chunk is the shared packer's.
import { request, ServerError } from "./api.js";
import { AAD, DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { pruneChunkCache, readCachedChunk, writeCachedChunk } from "./manifest-chunk-cache.js";
import { keepTrying } from "./net-retry.js";
import { registerNodeZstd } from "./zstd-node.js";
import { AAD_FILE_LIST_CHUNK, chunkFingerprint, decodeChunk, decodeFileList, encodeChunk, encodeIndex, FILE_LIST_VERSION_CHUNKED, } from "./shared/lib/drive/manifest-chunks.js";
import { packAll, repack } from "./shared/lib/drive/manifest-pack.js";
/** How many chunk requests are in flight at once. Enough to fill a link, few enough to stay fair. */
const CONCURRENCY = 4;
const utf8 = new TextEncoder();
/** A list this machine could not read completely. Never rendered as an empty or shorter drive. */
export class ManifestChunkError extends NmtsError {
    constructor(message) {
        super(message, {
            exitCode: 1,
            nextStep: "Nothing was changed. The list is stored in pieces and one of them did not arrive whole, " +
                "so what this command could show would be missing files. Try again; if it repeats, open " +
                "the account in a browser and compare before writing anything.",
        });
        this.name = "ManifestChunkError";
    }
}
function sealUnder(io, aad, body) {
    return Buffer.from(io.crypt.envelope_seal(io.key, utf8.encode(aad), body)).toString("base64url");
}
function openUnder(io, aad, ct) {
    return io.crypt.envelope_open(io.key, utf8.encode(aad), Buffer.from(ct, "base64url"));
}
/** What the two chunk routes answer. Narrowed here rather than trusted. */
function ctOf(answer) {
    const ct = typeof answer === "object" && answer !== null ? Reflect.get(answer, "ct") : null;
    if (typeof ct !== "string" || ct === "") {
        throw new ManifestChunkError("The server answered a part of the file list without its bytes.");
    }
    return ct;
}
/**
 * Fetch, verify and open every chunk the index names, four at a time.
 *
 * The result is in INDEX order, which is placement order (§6.3.3), so the list arrives sorted for
 * free. Afterwards the machine's own copies are pruned to what this index names: everything else
 * is a version nobody will ask for again.
 */
export async function openChunks(io, index) {
    registerNodeZstd();
    const refs = index.chunks;
    const out = new Array(refs.length);
    let next = 0;
    const worker = async () => {
        for (;;) {
            const at = next;
            next += 1;
            const ref = refs[at];
            if (ref === undefined)
                return;
            out[at] = { h: ref.h, f: ref.f, l: ref.l, items: await openOne(io, ref, index.seq) };
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length) }, worker));
    pruneChunkCache(io.accountId, new Set(refs.map((c) => c.h)));
    return out;
}
/** One chunk: from this machine if it has it, else from the server — verified either way. */
async function openOne(io, ref, indexSeq) {
    const cached = readCachedChunk(io.accountId, ref.h);
    let ct = cached;
    if (ct === null) {
        try {
            ct = ctOf(await request(io.server, `/v1/manifest/chunks/${ref.h}`, { token: io.apiKey }));
        }
        catch (error) {
            // ⛔ A chunk the server will not hand over is an INCOMPLETE list, and the command must say
            //    so. Carrying on with "the chunks that did arrive" would draw a drive missing files.
            throw new ManifestChunkError(`Part of the file list could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // ⛔ RE-HASHED EVEN WHEN IT CAME FROM THIS MACHINE'S OWN COPY. The name is the only thing tying
    //    these bytes to the index the account sealed, and a directory on this machine is storage
    //    anybody holding the machine can edit.
    if ((await chunkFingerprint(ct)) !== ref.h) {
        throw new ManifestChunkError("Part of the file list does not match the name the index gave it.");
    }
    let body;
    try {
        body = openUnder(io, AAD_FILE_LIST_CHUNK, ct);
    }
    catch {
        throw new ManifestChunkError("Part of the file list did not open with this account's key.");
    }
    const doc = await decodeChunk(body);
    body.fill(0);
    // A chunk keeps the version that MADE it (§6.3.2), so this is an upper bound and not equality:
    // a chunk claiming a version the index has not reached did not come from this history.
    if (doc.seq > indexSeq) {
        throw new ManifestChunkError(`Part of the file list claims version ${doc.seq}, after the index's ${indexSeq}.`);
    }
    if (doc.items.length !== ref.n) {
        throw new ManifestChunkError(`Part of the file list holds ${doc.items.length} entries where the index says ${ref.n}.`);
    }
    if (cached === null)
        writeCachedChunk(io.accountId, ref.h, ct);
    return doc.items;
}
/**
 * Write these entries as version 2: the chunks that changed, then the index that names them all.
 *
 * ⛔ ONLY WHAT CHANGED IS SENT. The packer compares the new entries against the chunks the read
 *    handed over and keeps every chunk whose contents came through untouched, so a rename uploads
 *    one chunk instead of the whole list. That is the entire point of this format version.
 *
 * ⚠ A LOST COMPARE-AND-SWAP COMES BACK AS ITSELF. The caller re-reads and re-applies its intent;
 *   the chunks written by the losing attempt are named by no index and the server sweeps them.
 */
export async function writeChunkedList(io, plan) {
    registerNodeZstd();
    const packed = plan.previous.length > 0 ? repack(plan.previous, plan.entries) : packAll(plan.entries);
    const rows = [];
    const held = [];
    const fresh = new Map();
    for (const chunk of packed) {
        let name = chunk.reuse;
        if (name === undefined) {
            const body = await encodeChunk({
                v: FILE_LIST_VERSION_CHUNKED,
                seq: plan.seq,
                items: chunk.items,
            });
            const ct = sealUnder(io, AAD_FILE_LIST_CHUNK, body);
            body.fill(0);
            name = await chunkFingerprint(ct);
            fresh.set(name, ct);
        }
        rows.push({ h: name, n: chunk.items.length, f: chunk.f, l: chunk.l });
        held.push({ h: name, f: chunk.f, l: chunk.l, items: chunk.items });
    }
    await putChunks(io, fresh);
    const body = await encodeIndex({
        v: FILE_LIST_VERSION_CHUNKED,
        seq: plan.seq,
        ...(plan.prev !== undefined ? { p: plan.prev } : {}),
        settings: plan.settings,
        chunks: rows,
    });
    // The index is sealed under the file-list label the single blob always used, so a build that
    // does not know version 2 opens it and refuses it by version — the designed outcome of §6.1.
    const ct = sealUnder(io, AAD.fileList, body);
    body.fill(0);
    const refs = rows.map((r) => r.h);
    const seq = await putIndex(io, plan.baseSeq, ct, refs, fresh);
    pruneChunkCache(io.accountId, new Set(refs));
    return { seq, ct, held };
}
/**
 * Write the index, and answer the one refusal that has a mechanical remedy.
 *
 * `MANIFEST_CHUNK_MISSING` says the server does not hold a chunk this index names. The remedy is
 * to write this save's chunks again and send the same index once more: a chunk is stored under its
 * own hash, so re-writing one the server already has stores nothing and answers "existed". Chunks
 * this save REUSED are sent from this machine's own copies, which is the only place their exact
 * bytes still are — re-sealing would give a fresh nonce and therefore a different name.
 */
async function putIndex(io, baseSeq, ct, refs, fresh) {
    for (let attempt = 0;; attempt += 1) {
        try {
            return seqOf(await request(io.server, "/v1/manifest", {
                method: "PUT",
                token: io.apiKey,
                body: { base_seq: baseSeq, ct, refs },
            }));
        }
        catch (error) {
            const missing = error instanceof ServerError && error.code === "MANIFEST_CHUNK_MISSING";
            if (!missing || attempt > 0)
                throw error;
            const again = new Map(fresh);
            for (const name of refs) {
                if (again.has(name))
                    continue;
                const kept = readCachedChunk(io.accountId, name);
                if (kept !== null)
                    again.set(name, kept);
            }
            await putChunks(io, again);
        }
    }
}
/**
 * Write these sealed chunks, four at a time.
 *
 * ⚠ REPEATED ON THE SERVER'S "NOT RIGHT NOW". The chunk budget is a burst and then one write a
 *   second, so a save that converts a large list meets it. Repeating this particular write is
 *   safe in a way an ordinary write is not: the name IS the hash of the bytes, so a second copy of
 *   the request is the same request and the server answers "existed" rather than storing anything.
 */
async function putChunks(io, chunks) {
    const names = [...chunks.keys()];
    let next = 0;
    const worker = async () => {
        for (;;) {
            const at = next;
            next += 1;
            const name = names[at];
            if (name === undefined)
                return;
            const ct = chunks.get(name);
            if (ct === undefined)
                continue;
            await keepTrying(() => request(io.server, `/v1/manifest/chunks/${name}`, {
                method: "PUT",
                token: io.apiKey,
                body: { ct },
            }), { retryable: (error) => error instanceof ServerError && error.status === 429 });
            writeCachedChunk(io.accountId, name, ct);
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
}
function seqOf(answer) {
    if (typeof answer === "object" && answer !== null) {
        const seq = Reflect.get(answer, "seq");
        if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1)
            return seq;
    }
    throw new NmtsError("The file list was written but the server did not say which version it is now.", {
        nextStep: "The change is saved. Run `nmts ls` to see it.",
    });
}
/**
 * The chunk names a sealed index carries, or an empty list when these bytes are not one.
 *
 * ⛔ A ROLLBACK NEEDS THIS AND NOTHING ELSE FROM INSIDE THE LIST. Writing an index back as the
 *    current version without naming its chunks would let the server free them as unreferenced, and
 *    the restored list would open into a drive missing files. So the bytes are opened far enough
 *    to read the names, and no further.
 *
 * ⚠ BYTES THAT WILL NOT OPEN ANSWER "no chunks", which is the request `rollback` has always made.
 *   A list that does not open cannot be told apart from a version-1 one without opening it, and
 *   refusing here would refuse in a case the command used to handle.
 */
export async function namedChunks(code, ct) {
    registerNodeZstd();
    const crypt = await loadCrypto();
    const [from, to] = DERIVED.fileListKey;
    const derived = crypt.kdf_derive(crypt.account_code_parse(code));
    const key = derived.slice(from, to);
    derived.fill(0);
    try {
        const body = crypt.envelope_open(key, utf8.encode(AAD.fileList), Buffer.from(ct, "base64url"));
        const doc = await decodeFileList(body);
        body.fill(0);
        return doc.v === FILE_LIST_VERSION_CHUNKED ? doc.index.chunks.map((c) => c.h) : [];
    }
    catch {
        return [];
    }
    finally {
        key.fill(0);
    }
}
/**
 * The sealed chunks a kept index names, from this machine's own copies alone.
 *
 * Null means the kept bytes are a version-1 list, which carries its entries itself and needs
 * nothing beside it. A refusal means this machine holds the index but not everything it names, so
 * what could be written out would be an incomplete list — worse than none, because somebody would
 * keep it for years believing they were covered.
 */
export async function keptChunks(code, accountId, indexCt) {
    const names = await namedChunks(code, indexCt);
    if (names.length === 0)
        return null;
    const out = [];
    for (const name of names) {
        const ct = readCachedChunk(accountId, name);
        if (ct === null) {
            throw new NmtsError("This machine holds the file list's index but not all of its parts.", {
                exitCode: 4,
                nextStep: "Nothing was written. Run `nmts ls` once while this machine can reach the server: a " +
                    "read of the list fetches every part and keeps it here, and this command writes them " +
                    "out together with the index.",
            });
        }
        out.push(ct);
    }
    return out;
}

import { NmtsError } from "./errors.js";
import { NCF3_SHAPE } from "./seal.js";
import { isRecord } from "./guards.js";
import { readBlob, readQuiltPatch } from "./walrus.js";
import { NETWORK_WHEN_UNRECORDED, networkName } from "./shared/lib/storage-network.js";
import { reachFetch } from "./reach.js";
import { FILECOIN_CHAIN_FOR_NETWORK } from "./shared/lib/filecoin/providers.js";
import { readCopies } from "./shared/lib/heavy/order-wire.js";
/** `storage_kind` in the server's part rows. */
const DEDICATED_BLOB = 0;
const QUILT_PATCH = 1;
export function asParts(value) {
    if (!isRecord(value))
        throw new NmtsError("The server's answer was not an object.");
    const v = value;
    const size = v["size"];
    const parts = v["parts"];
    if (typeof size !== "number" || !Array.isArray(parts)) {
        throw new NmtsError("The server described this file in a shape this version cannot read.", {
            nextStep: "Update this tool, or open the file in a browser.",
        });
    }
    const out = [];
    for (const raw of parts) {
        if (!isRecord(raw))
            throw new NmtsError("A part was not an object.");
        const p = raw;
        if (typeof p["part_index"] !== "number" || typeof p["storage_kind"] !== "number" || typeof p["blob_id"] !== "string") {
            throw new NmtsError("A part is missing the fields needed to read it.");
        }
        const view = {
            part_index: p["part_index"],
            storage_kind: p["storage_kind"],
            blob_id: p["blob_id"],
        };
        if (typeof p["network"] === "number")
            view.network = p["network"];
        if (typeof p["patch_id"] === "string")
            view.patch_id = p["patch_id"];
        // ⚠ Checked field by field (`readCopies`); a list that does not read is left out, and the read
        //   below then says it has no copy to ask rather than asking a half-read address.
        const copies = p["copies"] === undefined ? null : readCopies(p["copies"]);
        if (copies !== null)
            view.copies = copies;
        out.push(view);
    }
    return { size, parts: out };
}
/**
 * Fetch one part's sealed bytes.
 *
 * ⛔ Refuse before reading, not after. A part on a storage network this build has no reader for
 *    would otherwise be fetched from a Walrus aggregator, 404, and be reported as missing bytes —
 *    which is a different thing and sends somebody looking for the wrong one.
 */
export async function fetchPart(part, chain, read) {
    const where = networkName(part.network ?? NETWORK_WHEN_UNRECORDED);
    if (where === "filecoin" && (chain === "testnet" || chain === "mainnet"))
        return readHeavyPart(part, chain, read);
    if (where !== "walrus") {
        throw new NmtsError(`Part ${part.part_index} is stored on ${where ?? `an unknown network (${part.network})`}, which this version cannot read.`, { nextStep: "Nothing was written. Open the file in a browser, which may know that network." });
    }
    if (part.storage_kind !== QUILT_PATCH && part.storage_kind !== DEDICATED_BLOB) {
        throw new NmtsError(`Part ${part.part_index} is stored in a way this version does not know (${part.storage_kind}).`);
    }
    return part.storage_kind === QUILT_PATCH && part.patch_id !== undefined
        ? readQuiltPatch(chain, part.patch_id, read ?? {})
        : readBlob(chain, part.blob_id, read ?? {});
}
/**
 * One NMTS Heavy part, from the first of its copies that serves it (`shared/lib/heavy/download.ts`,
 * the browser's own reader).
 *
 * ⛔ ANY https COMPANY, NOT ONLY THE LISTED ONES. The list exists because a browser page may only
 *    talk to hosts its security policy names; this program has no such policy, and somebody who paid
 *    from their own EVM wallet may have picked a company the list does not name. The bytes are
 *    judged by the decryption, as every part's are, so the company is not trusted either way.
 */
async function readHeavyPart(part, chain, read) {
    const { fetchHeavyPart } = await import("./shared/lib/heavy/download.js");
    const range = read?.range;
    const response = await fetchHeavyPart({
        pieceCid: part.blob_id,
        copies: part.copies ?? [],
        chain: FILECOIN_CHAIN_FOR_NETWORK[chain],
        allowUnlisted: true,
        fetchImpl: reachFetch,
        ...(range === undefined ? {} : { range }),
        ...(read?.signal === undefined ? {} : { signal: read.signal }),
    });
    const body = new Uint8Array(await response.arrayBuffer());
    if (range === undefined)
        return body;
    // A 206 holds exactly the asked-for bytes; a company that ignored `Range` sent the part from zero.
    return body.length === range.end - range.start ? body : body.subarray(range.start, range.end);
}
/**
 * Open ONE part and pass its contribution on, a chunk at a time. Returns how much of the file it
 * contributed.
 *
 * ⛔ THE SEALED BYTES ARE FED IN ONE CHUNK AT A TIME, not all at once. Handing the engine the whole
 *    part would make it hand back the whole part's plaintext in one array, which is the ceiling
 *    this path exists to remove; feeding it a chunk's worth means at most one chunk of plaintext
 *    exists at a time. The size fed is the format's own chunk plus its tag, so a well-formed
 *    stream yields exactly one chunk per push — and a stream whose header declares a different
 *    chunk size still works, because the engine buffers what it has not finished.
 *
 * ⛔ `finish()` IS WHAT CATCHES A PART CUT SHORT. Every chunk that arrived authenticates; only the
 *    end-of-stream check knows the rest is missing. Skipping it would accept a truncated part.
 *    ⚠ The one caller that skips it is a RANGE that asked for the part's first chunks only
 *    (`prefix`): it wants no byte past them, and every byte it keeps is authenticated.
 *
 * ⛔ THE ENGINE-SIDE SESSION IS FREED ON EVERY PATH OUT, including a failure: it holds the file
 *    key until it is, and a download that failed is exactly when nobody comes back to tidy up.
 */
export async function openPart(crypt, dek, part, sealed, position, remaining, emit, prefix = false) {
    const isLast = position.index === position.total - 1;
    const refuse = refusal(part);
    if (sealed.length < NCF3_SHAPE.headerLen)
        throw refuse();
    // ⛔ POSITIONAL, AS NCF-3 §4.1 REQUIRES. The header names its own place (`part_index` of
    //    `part_total`, bytes 8..16) and every chunk authenticates that header — so a stream fetched in
    //    a place it does not claim still decrypts, and only this comparison notices. A reordered or
    //    substituted list of pieces would otherwise be stitched together in the wrong order.
    const header = new DataView(sealed.buffer, sealed.byteOffset, NCF3_SHAPE.headerLen);
    const claimedIndex = header.getUint32(8, true);
    const claimedTotal = header.getUint32(12, true);
    if (claimedIndex !== position.index || claimedTotal !== position.total) {
        throw new NmtsError(`Part ${part.part_index} says it is part ${claimedIndex + 1} of ${claimedTotal}, but it was listed as part ${position.index + 1} of ${position.total}.`, { nextStep: "Nothing was written. The list of stored pieces does not match what was sealed." });
    }
    // ⚠ Constructed on the header alone, which is parsed and checked inside the engine, so a blob
    //   that is not an NCF-3 stream at all fails here rather than as a strange length later.
    let opener;
    try {
        opener = new crypt.StreamDecryptor(dek, sealed.subarray(0, NCF3_SHAPE.headerLen));
    }
    catch {
        throw refuse();
    }
    let taken = 0;
    let left = remaining;
    try {
        // ⚠ A chunk's worth at a time: the format's chunk plus its tag. A well-formed stream yields
        //   exactly one chunk per push, and a header declaring some other chunk size still works —
        //   the engine buffers whatever it has not finished.
        const feed = NCF3_SHAPE.chunkSize + NCF3_SHAPE.tagLen;
        for (let at = NCF3_SHAPE.headerLen; at < sealed.length; at += feed) {
            // ⛔ The push and the emit are in separate try blocks on purpose. Wrapping both would let a
            //    disk that filled up, or a pipe that refused, be reported as "this part did not
            //    decrypt" — sending somebody to look at the storage network for a fault on their own
            //    machine.
            let run;
            try {
                run = opener.push(sealed.subarray(at, Math.min(at + feed, sealed.length)));
            }
            catch {
                throw refuse();
            }
            if (run.length === 0)
                continue;
            // ⛔ Only the LAST part may hand back more than the file has left; that surplus is the
            //    padding the write side added to hide the true size. From any other part it means the
            //    file list and the stored bytes describe different files.
            const take = isLast ? Math.min(run.length, left) : run.length;
            if (take > left) {
                run.fill(0);
                throw new NmtsError(`Part ${part.part_index} contributes ${run.length} bytes and only ${left} of the file are left.`, { nextStep: "The file list and the stored parts do not agree. Nothing was written." });
            }
            try {
                await emit(run.subarray(0, take));
            }
            finally {
                // ⚠ Zeroed as soon as it has been passed on, failure included. A sink that kept the array
                //   instead of copying would find zeroes — which is why its contract says not to.
                run.fill(0);
            }
            taken += take;
            left -= take;
        }
        try {
            if (!prefix)
                opener.finish();
        }
        catch {
            throw refuse();
        }
    }
    finally {
        opener.free();
    }
    return taken;
}
function refusal(part) {
    return () => new NmtsError(`Part ${part.part_index} did not decrypt.`, {
        nextStep: "The bytes that arrived are not the bytes that were sealed. Nothing was written. " +
            "Try again — a different aggregator may hold the right ones.",
    });
}
/**
 * Read a part's 72-byte header, and refuse it unless it is THIS file's part at THIS position.
 *
 * ⛔ THE ENGINE CHECKS THE KEY COMMITMENT FIRST. It covers every field read below, so a length or a
 *    position that passes here was sealed under this file's key — a range that leaves the parts
 *    before it out works out where it starts from these numbers, and a lie in them would put
 *    authentic bytes at the wrong place in the answer.
 *
 * ⛔ THE POSITION IS THE ONE THE CALLER IS READING INTO, never the part's own claim: every part of a
 *    file is sealed under one key, so a part served in another's place passes the commitment and is
 *    caught only by comparing where it says it is with where it is being used.
 */
export function checkedHeader(crypt, dek, part, header, position) {
    const refuse = refusal(part);
    if (header.length < NCF3_SHAPE.headerLen)
        throw refuse();
    const bytes = header.subarray(0, NCF3_SHAPE.headerLen);
    try {
        new crypt.StreamDecryptor(dek, bytes).free();
    }
    catch {
        throw refuse();
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const log2 = view.getUint8(5);
    const declared = view.getBigUint64(16, true);
    if (view.getUint32(8, true) !== position.index || view.getUint32(12, true) !== position.total) {
        throw new NmtsError(`Part ${part.part_index} was served in the wrong place in the file.`, {
            nextStep: "The stored parts do not agree with the file this list describes. Nothing was written.",
        });
    }
    if (declared > BigInt(Number.MAX_SAFE_INTEGER) || log2 > 40)
        throw refuse();
    return { declared: Number(declared), chunkSize: 2 ** log2 };
}

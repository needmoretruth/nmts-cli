import { NmtsError } from "./errors.js";
import { NCF3_SHAPE } from "./seal.js";
import { isRecord } from "./guards.js";
import { readBlob, readQuiltPatch } from "./walrus.js";
import { NETWORK_WHEN_UNRECORDED, networkName } from "./shared/lib/storage-network.js";
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
 *
 * ⛔ THE ENGINE-SIDE SESSION IS FREED ON EVERY PATH OUT, including a failure: it holds the file
 *    key until it is, and a download that failed is exactly when nobody comes back to tidy up.
 */
export async function openPart(crypt, dek, part, sealed, isLast, remaining, emit) {
    const refuse = () => new NmtsError(`Part ${part.part_index} did not decrypt.`, {
        nextStep: "The bytes that arrived are not the bytes this account sealed. Nothing was written. " +
            "Try again — a different aggregator may hold the right ones.",
    });
    if (sealed.length < NCF3_SHAPE.headerLen)
        throw refuse();
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

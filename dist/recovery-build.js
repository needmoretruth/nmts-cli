// Building one account's recovery list end to end: read the whole account, join it to the sealed
// file list, check it against itself, seal it, and prove the sealed bytes open again.
//
// ⛔ IT NEVER PARTIALLY SUCCEEDS. If a page, a name or a key fails, the whole build fails. A list
//    that quietly omits files tells somebody they are covered when they are not, and they find out
//    on the one day it cannot be repaired.
//
// ⛔ IT DOES NOT TRUST THE ARRANGEMENT IT WAS HANDED. The storage parts come from a SERVER dump and
//    this artefact exists for the day that server is hostile or gone, so a file's part numbering
//    and its total length are checked against the account's own sealed file list before anything is
//    sealed. Two checks are available to a builder that fetches no blob, and both are free:
//      1. the numbering must be a complete 0…n-1 run. A repeated row, a gap, or a set shifted by
//         one all break it, and none can be produced by an honest server.
//      2. the parts must reconcile with the size in the sealed file list. That list is sealed under
//         the account key and the server cannot write it, which is what makes the size the one
//         number in the comparison an attacker does not control.
//    Check 1 catches what leaves the total intact; check 2 catches what leaves the numbering
//    intact. Neither proves that blob i really holds part i — only fetching it does, and the list
//    records `part_index` so that whoever fetches it later can.
//
// ⛔ TWO SOURCES, JOINED ON ID. The server is asked only for what it still owns — a file's storage
//    parts. Its NAME, its folder, its size and its key envelope come from the account's sealed file
//    list, because that is the only place the tree exists.
import { AAD, DERIVED } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { buildRecoveryListDoc, RecoveryListProblem, withTotals, } from "./recovery-map.js";
import { STORAGE_QUILT } from "./recovery-source.js";
import { NCF3_SHAPE } from "./seal.js";
import { freeCeiling, keepLengths, padmeLen, pow2Len, } from "./shared/lib/crypto/size-padding.js";
import { buildIndex, KIND_FOLDER, pathOf } from "./shared/lib/drive/manifest-index.js";
import { NETWORK_WHEN_UNRECORDED, networkName, } from "./shared/lib/storage-network.js";
import { CREDIT_BYTES } from "./upload-price.js";
const utf8 = new TextEncoder();
/** Path of the account root. Every file sits at this or below it. */
export const ROOT_PATH = "/";
/**
 * A path segment that cannot break the `/a/b` encoding.
 *
 * ⛔ Folder names are people's text and may contain `/`. Left alone, a folder literally called
 *    `a/b` is indistinguishable from two nested folders when a recovery splits the path, and the
 *    file lands in the wrong place. The name itself is preserved exactly in the item's `name`.
 *
 * ⚠ RESTATED FROM `web/src/lib/recovery/paths.ts`, which this package cannot import. The
 *   substitute character is part of what a reader sees, so it must be the same one.
 */
function segment(name) {
    return name.replaceAll("/", "／");
}
/** Folder names, root-down, as the `/a/b` string the format stores. Empty means the root. */
export function pathString(names) {
    if (names.length === 0)
        return ROOT_PATH;
    return `/${names.map(segment).join("/")}`;
}
/**
 * Every padded length THIS BUILD could have written for a part of `len` real bytes.
 *
 * ⛔ FOR THE WRITER ONLY. A READER must not enforce it: it may be years newer or older than the
 *    build that sealed the part, and refusing a file because its padding follows a rule this copy
 *    has not heard of turns a recovery into a refusal for no gain.
 *
 * # What it defends
 * Before padding, the arithmetic was an equality — the parts had to sum to exactly the `size` in
 * the sealed file list — and that is what caught a server inflating a length so a truncated file
 * looked whole. Padding makes the last part's declared length legitimately larger, so the equality
 * alone would read an inflated length as padding. Checking it against the finite set of numbers
 * our own rules produce puts almost all of that back: an inflated length has to LAND on one.
 *
 * ⚠ RESTATED FROM `web/src/lib/crypto/padding.ts::paddingCandidates`. The rules themselves are not
 *   restated — `padmeLen`, `pow2Len` and `freeCeiling` are the shared byte-for-byte copy.
 */
function couldBePadding(len, declared) {
    const floor = freeCeiling(len, CREDIT_BYTES, NCF3_SHAPE);
    const rules = [len, padmeLen(len), pow2Len(len)];
    return [...rules, ...rules.map((r) => Math.max(r, floor))].includes(declared);
}
function describeAll(entries) {
    const index = buildIndex(entries);
    const out = new Map();
    for (const entry of entries) {
        out.set(entry.id, {
            name: entry.name,
            isFolder: entry.kind === KIND_FOLDER,
            size: entry.size,
            dekWrapped: entry.dekWrapped,
            contentHashCt: entry.contentHashCt,
            path: pathOf(index, entry),
        });
    }
    return out;
}
/** base64url of the RAW bytes inside one envelope sealed under the account's data key. */
function openRaw(crypt, dataKey, envelope, aad, what) {
    let opened;
    try {
        opened = crypt.envelope_open(dataKey, utf8.encode(aad), Buffer.from(envelope, "base64url"));
    }
    catch {
        // ⛔ The engine's own message is not repeated: it can quote what it was given.
        throw new RecoveryListProblem(`${what} did not open with this account's key, so it cannot be written down. ` +
            `The recovery list was not written.`);
    }
    try {
        return Buffer.from(opened).toString("base64url");
    }
    finally {
        opened.fill(0);
    }
}
/** Build and seal the account's recovery list. Throws on any discrepancy; there is no partial list. */
export function buildRecoveryList(input) {
    const described = describeAll(input.entries);
    const items = [];
    let totalBytes = 0;
    for (const stored of input.source) {
        const about = described.get(stored.id);
        // A stored file the list does not describe cannot be named or placed, and a list that omitted
        // it would claim to cover an account it does not.
        if (about === undefined) {
            throw new RecoveryListProblem(`Stored file ${stored.id} is missing from your file list, so it cannot be described. ` +
                `The recovery list was not written.`);
        }
        if (about.isFolder)
            continue;
        if (about.dekWrapped === undefined) {
            throw new RecoveryListProblem(`Stored file ${stored.id} has no stored key, so it could never be opened again. ` +
                `The recovery list was not written.`);
        }
        if (stored.parts.length === 0) {
            throw new RecoveryListProblem(`Stored file ${stored.id} has no stored parts, so there would be nothing to fetch. ` +
                `The recovery list was not written.`);
        }
        const ordered = [...stored.parts].sort((a, b) => a.part_index - b.part_index);
        const misnumbered = ordered.findIndex((p, i) => p.part_index !== i);
        if (misnumbered >= 0) {
            throw new RecoveryListProblem(`Stored file ${stored.id} has a part numbered ${ordered[misnumbered]?.part_index} where ` +
                `part ${misnumbered} should be, so its ${ordered.length} stored parts are not a ` +
                `complete set. The recovery list was not written.`);
        }
        let keeps;
        try {
            keeps = keepLengths(about.size, ordered.map((p) => p.streamPlaintextLen));
        }
        catch {
            // ⛔ THE SIZE IS NOT IN THE SENTENCE. A file's plaintext length is a value the server is not
            //    told, and a message that printed it would put it in whatever the caller logs.
            throw new RecoveryListProblem(`Stored file ${stored.id} has ${ordered.length} stored parts that do not add up to the ` +
                `size in your file list. A part is missing, repeated, or the wrong length. ` +
                `The recovery list was not written.`);
        }
        const parts = ordered.map((p, i) => {
            const keep = keeps[i] ?? 0;
            // ⭐ AND THE PADDING ITSELF HAS TO BE A NUMBER THIS BUILD COULD HAVE WRITTEN. Without this
            //    the check above softens: an inflated last-part length reads as padding, and a truncated
            //    file seals into a list that says the account is covered.
            if (p.streamPlaintextLen > keep && !couldBePadding(keep, p.streamPlaintextLen)) {
                throw new RecoveryListProblem(`Stored file ${stored.id} has a part ${i} whose stored stream is not padded by any rule ` +
                    `this version writes. The recovery list was not written.`);
            }
            const part = {
                blob_id: p.blob_id,
                plaintext_len: keep,
                // Every part names its network, even the default one: this is read years later by a tool
                // that has only this document, and "it must have been the network that existed back then"
                // is not something to make a stranger reason about.
                network: nameOfNetwork(p, stored.id),
            };
            if (p.streamPlaintextLen > keep)
                part.padded_len = p.streamPlaintextLen;
            if (p.sui_object_id !== undefined)
                part.sui_object_id = p.sui_object_id;
            return part;
        });
        // A quilted file is one patch inside one shared blob — by construction one part — so the
        // placement is read off that part rather than tracked separately.
        const patch = ordered.find((p) => p.storage_kind === STORAGE_QUILT && p.patch_id !== undefined && p.patch_id.length > 0);
        const item = {
            id: stored.id,
            name: about.name,
            path: pathString(about.path),
            size: about.size,
            dek: openRaw(input.crypt, input.dataKey, about.dekWrapped, AAD.dekWrap, `the key of ${about.name}`),
            // Straight from the dump: the one pair of values in an item that nothing here can check.
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            parts,
        };
        if (about.contentHashCt !== undefined) {
            // RAW in this document on purpose: the live drive keeps it sealed so the server cannot use
            // it as a cross-account fingerprint, and inside one authenticated envelope that precaution
            // is redundant. Carrying it open is what lets a standalone tool check a reassembled file.
            item.contentHash = openRaw(input.crypt, input.dataKey, about.contentHashCt, AAD.contentHash, `the content hash of ${about.name}`);
        }
        if (patch?.patch_id !== undefined) {
            item.quilt = { quilt_blob_id: patch.blob_id, patch_id: patch.patch_id };
        }
        items.push(item);
        totalBytes += about.size;
    }
    const doc = buildRecoveryListDoc({
        seq: input.seq,
        // ⛔ ALWAYS NULL FROM THIS TOOL. `prev_manifest_blob_id` chains MIRRORS: it is a storage-network
        //    address, and a list written to somebody's own disk has none for a successor to point at.
        //    `seq` still increases across every list of either kind, so "which is newest" stays
        //    answerable; only "what came before it" is unavailable for the stretches never mirrored.
        prevBlobId: null,
        generatedAt: input.generatedAt,
        accountId: input.accountId,
        // Finished here because here is where they are first true: everything before this point could
        // still throw, and a block claiming a count for a document that was never written would be the
        // one kind of self-description worse than none.
        meta: withTotals(input.meta, { items: items.length, bytes: totalBytes }),
        items,
    });
    const json = JSON.stringify(doc);
    const sealed = Buffer.from(input.crypt.envelope_seal(input.dataKey, utf8.encode(AAD.recoveryMap), utf8.encode(json))).toString("base64url");
    // ⛔ READ IT BACK BEFORE ANYBODY IS TOLD IT EXISTS. Catches a truncated seal, a wrong key, and
    //    any future change that returns something other than what it just sealed. Without it, "your
    //    list covers 412 files" is an assumption rather than a measurement.
    let reopened;
    try {
        reopened = input.crypt.envelope_open(input.dataKey, utf8.encode(AAD.recoveryMap), Buffer.from(sealed, "base64url"));
    }
    catch {
        throw new NmtsError("The sealed recovery list did not open again on this machine.", {
            exitCode: 1,
            nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
        });
    }
    if (Buffer.from(reopened).toString("utf8") !== json) {
        throw new NmtsError("The sealed recovery list did not come back as what was sealed.", {
            exitCode: 1,
            nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
        });
    }
    reopened.fill(0);
    // ⛔ THE OTHER DIRECTION. A file the sealed list names that the dump never returned is not a
    //    reason to refuse — but it is a reason not to call the account covered.
    const returned = new Set(input.source.map((s) => s.id));
    const missingFromSource = [...described.entries()]
        .filter(([id, about]) => !about.isFolder && about.dekWrapped !== undefined && !returned.has(id))
        .map(([id]) => id);
    return { sealed, doc, fileCount: items.length, totalBytes, missingFromSource };
}
/**
 * The NAME a list stores for a part's storage network. Refuses a code this build does not know.
 *
 * ⛔ NO NEAR MATCH. A code from a newer client means these bytes are somewhere this build cannot
 *    name, and writing "walrus" anyway would send a future recovery to the wrong network with no
 *    sign anything was wrong. An ABSENT field is a different matter: it predates the field and
 *    really is Walrus.
 */
function nameOfNetwork(part, itemId) {
    const name = networkName(part.network ?? NETWORK_WHEN_UNRECORDED);
    if (name === null) {
        throw new RecoveryListProblem(`Stored file ${itemId} is on storage network ${part.network}, which this version does not ` +
            `know how to name. Update this tool and try again. The recovery list was not written.`);
    }
    return name;
}

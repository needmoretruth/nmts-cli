// The RECOVERY LIST DOCUMENT — the exact JSON shape that gets sealed, and nothing else.
//
// ⛔ THIS FORMAT HAS TWO INDEPENDENT IMPLEMENTATIONS AND THIS IS A THIRD WRITER. The browser
//    writes it (`web/src/lib/recovery/manifest-doc.ts`), the standalone recovery program reads it
//    in Rust (`crypto/src/manifest.rs`), and the authority both answer to is
//    `docs/RECOVERY-MANIFEST.md` §2. A writer that drifts is not discovered by a failing test — it
//    is discovered years later, by somebody who has nothing left but this file.
//
// ⛔ FIELD NAMES ARE snake_case AND THAT IS NOT THIS CODEBASE'S STYLE. They are the wire format.
//
// ⛔ NOTHING HERE TOUCHES A KEY. Callers hand in file keys and content hashes already opened and
//    re-encoded as base64url; opening them is the builder's job, one layer up.
//
// ⚠ RESTATED FROM THE BROWSER'S ENCODER, WHICH THIS PACKAGE CANNOT IMPORT — the two trees share no
//   code by design, and the browser's copy pulls in its own types tree. What is restated is the
//   SHAPE and the four refusals below; the arithmetic that decides how much of a padded part is
//   real is not restated at all, because `shared/lib/crypto/size-padding.ts` is a byte-for-byte
//   copy of the browser's own file and a gate compares them.
import { NmtsError } from "./errors.js";
/** The newest NRM version this writer knows how to emit. */
export const NRM_VERSION_LATEST = 4;
/** The first NRM version in which every part carries `part_index`. */
export const NRM_VERSION_WITH_PART_INDEX = 2;
/** The first NRM version in which a quilt placement may be `{ identifier }` alone. */
export const NRM_VERSION_WITH_OWN_QUILT = 3;
/** The first NRM version in which a part may carry `padded_len`. */
export const NRM_VERSION_WITH_PADDING = 4;
/** Practical ceiling from RECOVERY-MANIFEST.md §1 — beyond this the format needs chunk framing. */
export const MANIFEST_ITEM_SOFT_CAP = 100_000;
/** Which form a placement is. One narrowing point, so "exactly one of the two" is decided here. */
export function isOwnQuilt(quilt) {
    return quilt.identifier !== undefined;
}
/**
 * Thrown when the input cannot produce a document a recovery tool could use.
 *
 * ⛔ IT IS AN `NmtsError`, NOT A BARE `Error`. Anything that reaches the top of this program as a
 *    bare error prints its message with no next step and exits with the generic code — and the
 *    generic code is the one an agent retries. A discrepancy here is never worth retrying: the
 *    server has to change, or the account does. Exit 4 is "the command exists and could not do
 *    it", which is exactly what happened.
 */
export class RecoveryListProblem extends NmtsError {
    constructor(message) {
        super(message, {
            exitCode: 4,
            nextStep: "Nothing was written, and that is deliberate: a list quietly missing files would tell you " +
                "you are covered when you are not. Retrying will not change it. The account screen at " +
                "nmts.me builds the same list from the same rows and will report the same thing.",
        });
        this.name = "RecoveryListProblem";
    }
}
/**
 * The lowest `v` a document holding these items may honestly declare.
 *
 * ⛔ A WRITER STAMPS THIS, NOT THE NEWEST NUMBER IT KNOWS. People already hold copies of the
 *    standalone recovery program, and a build only knows the forms that existed when it was made.
 *    Every version number in this format is a CEILING in every published build: a document
 *    declaring a number higher than a build knows is REFUSED, unread. So stamping `4` for no
 *    reason other than the calendar would be a wall in front of a reader that would have
 *    understood every byte of it.
 */
export function minimumVersion(items) {
    if (items.some((it) => it.parts.some((p) => p.padded_len !== undefined))) {
        return NRM_VERSION_WITH_PADDING;
    }
    const ownQuilt = items.some((it) => it.quilt !== undefined && isOwnQuilt(it.quilt));
    return ownQuilt ? NRM_VERSION_WITH_OWN_QUILT : NRM_VERSION_WITH_PART_INDEX;
}
/**
 * Assemble the document.
 *
 * Rejects rather than emits a list that would mislead somebody in a recovery: a file with no parts
 * has nothing to fetch, a part list that does not add up to the file's size is missing or repeating
 * bytes, a part that says it is somewhere other than where it sits contradicts itself, and a
 * `seq` below 1 is not a version at all. The hostile-input version of the middle two is caught one
 * layer up, where the size being compared against comes from a source the server cannot write —
 * but the cost of shipping any of them is that somebody believes they are covered when they are
 * not, so they are checked here too rather than assumed.
 */
export function buildRecoveryListDoc(input) {
    if (!Number.isSafeInteger(input.seq) || input.seq < 1) {
        throw new RecoveryListProblem(`seq must be a whole number of at least 1 (got ${input.seq})`);
    }
    if (input.items.length > MANIFEST_ITEM_SOFT_CAP) {
        throw new RecoveryListProblem(`a recovery list of ${input.items.length} files is above the format's cap of ${MANIFEST_ITEM_SOFT_CAP}`);
    }
    const items = input.items.map((it) => {
        if (it.parts.length === 0) {
            throw new RecoveryListProblem(`item ${it.id} has no parts — nothing to recover from`);
        }
        const partBytes = it.parts.reduce((sum, p) => sum + p.plaintext_len, 0);
        if (partBytes !== it.size) {
            throw new RecoveryListProblem(`item ${it.id} is ${it.size} bytes but its ${it.parts.length} parts hold ${partBytes}`);
        }
        // Where the bytes are, decided once per item. The reader's copy of these two rules is
        // `crypto/src/manifest.rs::check_quilt_placement`: a document this emits and that parser
        // refuses would be discovered on the one day it cannot be repaired.
        if (it.quilt !== undefined && isOwnQuilt(it.quilt)) {
            const first = it.parts[0];
            if (it.parts.length !== 1 || first === undefined || first.blob_id !== undefined) {
                throw new RecoveryListProblem(`item ${it.id}: an own-quilt item must be exactly one part with no blob_id`);
            }
        }
        else {
            const missing = it.parts.findIndex((p) => p.blob_id === undefined);
            if (missing >= 0) {
                throw new RecoveryListProblem(`item ${it.id}: the part at position ${missing} has no blob_id and no own-quilt placement`);
            }
        }
        const item = {
            id: it.id,
            name: it.name,
            path: it.path,
            size: it.size,
            dek: it.dek,
            kind: "file",
            // Absent, never null: the format says a field that was not recorded is not there, and a
            // reader must not have to tell two spellings of "not recorded" apart.
            ...(it.createdAt ? { created_at: it.createdAt } : {}),
            ...(it.updatedAt ? { updated_at: it.updatedAt } : {}),
            parts: it.parts.map((p, i) => {
                // ⛔ THE POSITION IS THE VALUE. Taking `part_index` from the array rather than from the
                //    caller's field is what makes the two impossible to disagree about in the written
                //    document; a caller that states its own number is checked against the position, because
                //    a disagreement means the order it handed in is not the order it meant.
                if (p.part_index !== undefined && p.part_index !== i) {
                    throw new RecoveryListProblem(`item ${it.id}: the part at position ${i} says it is part ${p.part_index}`);
                }
                const part = p.blob_id === undefined
                    ? { part_index: i, plaintext_len: p.plaintext_len }
                    : { part_index: i, blob_id: p.blob_id, plaintext_len: p.plaintext_len };
                // Strictly larger, or absent. Equal is not padding — writing it would make two identical
                // lists differ in their bytes — and smaller is a stream that could not hold the part.
                if (p.padded_len !== undefined) {
                    if (!Number.isSafeInteger(p.padded_len) || p.padded_len <= p.plaintext_len) {
                        throw new RecoveryListProblem(`item ${it.id}: the part at position ${i} contributes ${p.plaintext_len} bytes ` +
                            `out of a padded ${p.padded_len}`);
                    }
                    part.padded_len = p.padded_len;
                }
                if (p.sui_object_id)
                    part.sui_object_id = p.sui_object_id;
                if (p.network)
                    part.network = p.network;
                return part;
            }),
        };
        if (it.contentHash)
            item.content_hash = it.contentHash;
        // Rebuilt rather than passed through, so a caller that supplied an explicit `undefined`
        // beside the form it meant cannot put an extra key in the byte output.
        if (it.quilt !== undefined) {
            item.quilt = isOwnQuilt(it.quilt)
                ? { identifier: it.quilt.identifier }
                : { quilt_blob_id: it.quilt.quilt_blob_id, patch_id: it.quilt.patch_id };
        }
        return item;
    });
    return {
        v: minimumVersion(items),
        seq: input.seq,
        // Kept as an explicit null so a reader can tell the head of the chain apart from a writer that
        // never implemented chaining.
        prev_manifest_blob_id: input.prevBlobId,
        generated_at: input.generatedAt,
        account_id: input.accountId,
        // ⛔ Omitted when absent rather than written as null, and NOT a reason to raise `v`: every
        //    field in it is additive and its absence changes no meaning, so the recovery builds
        //    already in people's hands read a document carrying it exactly as one without it.
        ...(input.meta ? { meta: input.meta } : {}),
        items,
    };
}
/** Finish a draft once the document's contents are known. */
export function withTotals(draft, totals) {
    return { ...draft, totals };
}
/** The `meta` block for this build, minus the totals. */
export function recoveryDocMeta(about, storage) {
    return {
        product: about.product,
        product_url: about.product_url,
        app_version: about.app_version,
        tool: about.tool,
        tool_url: about.tool_url,
        spec_url: about.spec_url,
        storage,
    };
}

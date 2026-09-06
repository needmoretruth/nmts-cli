import type { ArtifactAbout } from "./artifact-about.ts";
import { NmtsError } from "./errors.ts";
/** The newest NRM version this writer knows how to emit. */
export declare const NRM_VERSION_LATEST = 4;
/** The first NRM version in which every part carries `part_index`. */
export declare const NRM_VERSION_WITH_PART_INDEX = 2;
/** The first NRM version in which a quilt placement may be `{ identifier }` alone. */
export declare const NRM_VERSION_WITH_OWN_QUILT = 3;
/** The first NRM version in which a part may carry `padded_len`. */
export declare const NRM_VERSION_WITH_PADDING = 4;
/** Practical ceiling from RECOVERY-MANIFEST.md §1 — beyond this the format needs chunk framing. */
export declare const MANIFEST_ITEM_SOFT_CAP = 100000;
/** One stored piece of a file, in order. */
export interface ManifestPart {
    /**
     * Where this part belongs: 0 for the first, and the position it must be concatenated at
     * thereafter. Required from NRM-2.
     *
     * It is written down because array order alone cannot be CHECKED. A reader holds each fetched
     * part's 72-byte NCF-3 header, which carries the index sealed under the file key, so with this
     * field it can compare three things that must agree: the position it is writing at, what the
     * list says belongs there, and what the bytes themselves say they are.
     */
    part_index: number;
    /** Blob id holding this part's stream, in `network`'s own naming. */
    blob_id?: string;
    /** The REAL bytes this part contributes to the file. */
    plaintext_len: number;
    /**
     * What the stored stream's header DECLARES, when the part was padded and that is larger.
     * Absent means it was not padded. New in NRM-4.
     *
     * ⛔ THE TWO NUMBERS STAY APART so that "the parts sum to exactly `size`" keeps its exact
     *    strength. Folded into one, the check softens to "at least", which accepts any size below
     *    the real one: the file comes back short and nothing says so.
     */
    padded_len?: number;
    /** On-chain blob object, when the uploading client captured it. Omitted, never null. */
    sui_object_id?: string;
    /**
     * Which storage network holds `blob_id` — a NAME (`"walrus"`), not a code.
     *
     * A word rather than a number because whoever parses this may be doing so years from now with
     * none of our code beside them, and a bare `1` is not something a stranger can look up.
     */
    network?: string;
}
/** As a writer hands one in: the position is the value, so `part_index` is filled by the encoder. */
export interface ManifestPartInput extends Omit<ManifestPart, "part_index"> {
    part_index?: number;
}
/** Quilt placement naming a quilt anywhere on the network. */
export interface ManifestQuiltAbsolute {
    quilt_blob_id: string;
    patch_id: string;
    identifier?: undefined;
}
/** The own-quilt form (NRM-3): "the quilt this document was read out of". */
export interface ManifestQuiltOwn {
    identifier: string;
    quilt_blob_id?: undefined;
    patch_id?: undefined;
}
export type ManifestQuilt = ManifestQuiltAbsolute | ManifestQuiltOwn;
/** Which form a placement is. One narrowing point, so "exactly one of the two" is decided here. */
export declare function isOwnQuilt(quilt: ManifestQuilt): quilt is ManifestQuiltOwn;
/** One recoverable file. */
export interface ManifestItem {
    id: string;
    name: string;
    /** Logical folder path, e.g. `/photos/2026`. Root is `/`. */
    path: string;
    size: number;
    /** The file key, base64url of 32 RAW bytes — the list IS the recovery key store. */
    dek: string;
    kind: "file";
    /**
     * When the file was created and last changed, RFC3339.
     *
     * ⚠ THE ONLY VALUES IN AN ITEM THAT NOTHING CHECKS. Everything else is either sealed under the
     *   account key or constrained arithmetically by something that is; these two are simply what
     *   the storage layer said. A reader may STAMP them onto restored files and must not order,
     *   compare or decide anything with them.
     */
    created_at?: string;
    updated_at?: string;
    /** sha256 of the whole plaintext, base64url of 32 RAW bytes. Omitted when unrecorded. */
    content_hash?: string;
    parts: ManifestPart[];
    quilt?: ManifestQuilt;
}
/** What a caller hands in for one file. */
export interface ManifestItemInput {
    id: string;
    name: string;
    path: string;
    size: number;
    dek: string;
    contentHash?: string | undefined;
    createdAt?: string | undefined;
    updatedAt?: string | undefined;
    parts: readonly ManifestPartInput[];
    quilt?: ManifestQuilt | undefined;
}
/** Where the bytes this document points at actually live. */
export interface StorageDescription {
    network: string;
    /** ⭐ WHICH chain issued the blob ids — the field that stops a reader guessing between two. */
    chain: string;
    /** Read endpoints this build was using. HINTS, read after a reader's own defaults. */
    aggregators: readonly string[];
    chain_rpc: string;
}
/**
 * What the document says about ITSELF, sealed with it.
 *
 * ⚠ `totals` IS NOT AN INTEGRITY CHECK and a reader must not treat a disagreement as tampering.
 *   The document is one authenticated envelope. It is for a RE-IMPLEMENTATION, which drops records
 *   it does not recognise and otherwise has no way to notice it read 400 of 412 files.
 */
export interface RecoveryDocMeta {
    product: string;
    product_url: string;
    app_version: string;
    tool: string;
    tool_url: string;
    spec_url: string;
    storage: StorageDescription;
    totals: {
        items: number;
        bytes: number;
    };
}
/** The document itself. */
export interface RecoveryListDoc {
    v: number;
    /** Monotonic per account. Orders the chain — timestamps do not (device clocks lie). */
    seq: number;
    /** Blob id of the list this supersedes; explicitly `null` at the head of the chain. */
    prev_manifest_blob_id: string | null;
    generated_at: string;
    account_id: string;
    meta?: RecoveryDocMeta;
    items: ManifestItem[];
}
export interface BuildRecoveryListDocInput {
    seq: number;
    prevBlobId: string | null;
    generatedAt: string;
    accountId: string;
    meta?: RecoveryDocMeta | undefined;
    items: readonly ManifestItemInput[];
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
export declare class RecoveryListProblem extends NmtsError {
    constructor(message: string);
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
export declare function minimumVersion(items: readonly ManifestItem[]): number;
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
export declare function buildRecoveryListDoc(input: BuildRecoveryListDocInput): RecoveryListDoc;
/** What this tool writes into a document's `meta`, minus the totals only the builder knows. */
export type RecoveryDocMetaDraft = Omit<RecoveryDocMeta, "totals">;
/** Finish a draft once the document's contents are known. */
export declare function withTotals(draft: RecoveryDocMetaDraft, totals: {
    items: number;
    bytes: number;
}): RecoveryDocMeta;
/** The `meta` block for this build, minus the totals. */
export declare function recoveryDocMeta(about: ArtifactAbout, storage: StorageDescription): RecoveryDocMetaDraft;

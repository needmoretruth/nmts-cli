import { type CryptoGlue } from "./crypto.ts";
import { type ManifestItemInput, type RecoveryDocMetaDraft, type RecoveryListDoc } from "./recovery-map.ts";
import { type SourceItem } from "./recovery-source.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
/** Path of the account root. Every file sits at this or below it. */
export declare const ROOT_PATH = "/";
/** Folder names, root-down, as the `/a/b` string the format stores. Empty means the root. */
export declare function pathString(names: readonly string[]): string;
/** base64url of the RAW bytes inside one envelope sealed under the account's data key. */
export declare function openRaw(crypt: CryptoGlue, dataKey: Uint8Array, envelope: string, aad: string, what: string): string;
export interface BuildRecoveryListInput {
    crypt: CryptoGlue;
    /** ⛔ BORROWED, NOT KEPT. The caller derived it and the caller wipes it. */
    dataKey: Uint8Array;
    accountId: string;
    /** The account's own sealed file list, opened. */
    entries: readonly ManifestEntry[];
    /** Every live stored file, as the server described it. */
    source: readonly SourceItem[];
    /** This list's own version. Higher is newer. */
    seq: number;
    /** RFC3339, stamped by the caller before the walk began. */
    generatedAt: string;
    /** Files riding in the quilt this list goes into (NRM-3 own-quilt form), appended after the rest. */
    pending?: readonly ManifestItemInput[] | undefined;
    /** The storage-network copy this one follows, when it is itself such a copy. */
    prevBlobId?: string | null | undefined;
    meta: RecoveryDocMetaDraft;
}
export interface BuiltRecoveryList {
    /** The sealed list — base64url of one NCF-3 envelope. */
    sealed: string;
    /** The document that was sealed, so a caller can read what it says without opening anything. */
    doc: RecoveryListDoc;
    fileCount: number;
    totalBytes: number;
    /**
     * Live files the sealed file list names that the dump did not return.
     *
     * ⛔ NOT A REFUSAL — a short list beats none, and the ordinary cause is a file whose upload never
     *    committed. But a caller must not report the account as covered while this is not empty.
     */
    missingFromSource: readonly string[];
}
/** Build and seal the account's recovery list. Throws on any discrepancy; there is no partial list. */
export declare function buildRecoveryList(input: BuildRecoveryListInput): BuiltRecoveryList;

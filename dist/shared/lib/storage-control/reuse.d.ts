import { Transaction } from "@mysten/sui/transactions";
/** Whether one resource CERTAINLY holds this file — true means it does; false means "unknown", not "it cannot". */
export interface FitInput {
    /** The space the resource holds (bytes AFTER encoding) — the chain's `storage_size`. */
    readonly resourceSizeBytes: number;
    /** The BEFORE-encoding size of the file this resource used to hold. Absent = defer the judgement. */
    readonly heldRawBytes?: number;
    /** The BEFORE-encoding size of the file about to go in. */
    readonly newRawBytes: number;
    /** The epoch the resource ends at. */
    readonly resourceEndEpoch: number;
    /** The current epoch. */
    readonly currentEpoch: number;
}
/**
 * Only "it certainly fits" is true.
 *
 * ⛔ THE ENCODED LENGTH IS NOT COMPUTED HERE. That arithmetic is the protocol's and lives inside
 *    the SDK (unexported); a copy kept here would be wrong the day they change it, and only we
 *    would not know. ▶ Instead MONOTONICITY alone is used: the encoded length never shrinks as the
 *    raw length grows, so a new file no larger than the one the resource held certainly fits.
 * ⚠ This is therefore a SUFFICIENT condition. When it is false the real answer comes from a dry
 *   run — resources carry a 63 MiB floor, so a slightly larger file fitting a small file's slot
 *   is common in practice.
 */
export declare function surelyFits(input: FitInput): boolean;
export interface RegisterIntoInput {
    /** The Walrus system object. */
    readonly systemObjectId: string;
    /** The package to CALL — the system object's `package_id` field. ⛔ Not the type's prefix. */
    readonly walrusPackageId: string;
    /** The full type name of the WAL coin. */
    readonly walType: string;
    /** The resource already held. */
    readonly storageObjectId: string;
    /** What the encoder produced. */
    readonly blobIdAsInt: bigint;
    readonly rootHash: Uint8Array;
    readonly rawBytes: number;
    /** The write cost for this size, in FROST (WAL base units). */
    readonly writeCost: bigint;
    readonly deletable: boolean;
    /** Where the created blob object goes. */
    readonly owner: string;
}
/** A registration that uses ONE held storage resource as it is. */
export declare function registerIntoStorage(input: RegisterIntoInput, transaction?: Transaction): Transaction;
export interface SplitToFitInput {
    /** The package to CALL — the system object's `package_id`, as above. */
    readonly walrusPackageId: string;
    /** The resource to cut. After this call it is exactly `keepBytes` large. */
    readonly storageObjectId: string;
    /** The encoded size the file needs — what the cut resource keeps. */
    readonly keepBytes: number;
    /** Where the remainder — a NEW resource object — goes. */
    readonly owner: string;
}
/**
 * "Cut to fit": shrink a held resource to exactly what the file needs, so the rest stays a free
 * resource instead of being bound inside the blob. The owner's rule: the person chooses between
 * cutting and binding whole, and is shown the leftover in bytes — no default is chosen for them.
 *
 * ⛔ WHICH HALF IS WHICH IS THE CONTRACT'S CHOICE, read from `storage_resource.move`: `split_by_size`
 *    MODIFIES the given resource down to `split_size` and RETURNS a new object holding the rest.
 *    So the object id the caller already holds is the one that registers the blob afterwards, and
 *    the returned object is the leftover — which must be transferred, or the transaction is
 *    refused at assembly for an unused value.
 *
 * ⚠ `keepBytes` must be the ENCODED size (the chain's `encoded_blob_length`), never the raw one:
 *   registration checks `encoded_size <= storage_size` and a resource cut to the raw size fails it.
 */
export declare function splitStorageToFit(input: SplitToFitInput, transaction?: Transaction): Transaction;

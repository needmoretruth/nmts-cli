import type { StorageResource } from "./chain.ts";
/** Whether two resources can be fused, and if not, why. */
export type FuseVerdict = {
    readonly can: true;
    readonly kind: "amount" | "periods";
} | {
    readonly can: false;
    readonly why: "differentPeriod" | "differentSize" | "notAdjacent" | "same";
};
/**
 * Whether the contract will fuse these two.
 *
 * ⚠ Written so the order does not matter — the order a person picks them in means nothing.
 */
export declare function canFuse(a: StorageResource, b: StorageResource): FuseVerdict;
/**
 * Where a resource stands against the current epoch.
 *
 * ⛔ "Ended" is decided by COMPARING EPOCHS, not dates — the rule this product learned from its
 *    expiry display, for the same reason here.
 */
export declare function statusOf(resource: StorageResource, currentEpoch: number): "lapsed" | "notYet" | "usable";
/** Usable ones first, largest first. The order a list shows before anything else. */
export declare function usableFirst(resources: readonly StorageResource[], currentEpoch: number): StorageResource[];
/**
 * Whether a file of `encodedBytes` that must last until `needUntilEpoch` fits in this resource.
 *
 * ⚠ `encodedBytes` is the size AFTER the storage network's encoding, not the plaintext size.
 */
export declare function fits(resource: StorageResource, encodedBytes: number, needUntilEpoch: number): boolean;
/**
 * What is left of the resource after that file goes in.
 *
 * ⛔ Registration DOES NOT GIVE THE REMAINDER BACK — putting 500 MB into a 1 GB resource binds
 *    the whole gigabyte. That is why this number is shown: it is what a person chooses "cut to
 *    fit" or "use whole" on.
 */
export declare function leftoverBytes(resource: StorageResource, encodedBytes: number): number;
/** The sizes of the usable resources added up — the "space held right now" line. */
export declare function totalUsableBytes(resources: readonly StorageResource[], currentEpoch: number): number;

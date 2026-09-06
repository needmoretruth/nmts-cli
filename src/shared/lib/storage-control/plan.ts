// What can be done with a storage resource — pure judgement. Touches no chain and no screen.
// ⚠ PUBLISHED — copied byte-for-byte into the `nmts` command-line package; keep comments
// self-contained English.
//
// ⛔ ONLY WHAT THE CONTRACT ALLOWS IS ALLOWED (`storage_resource.move`, read verbatim 2026-08-11):
//    · `fuse_amount` — the periods must be IDENTICAL for the sizes to add;
//    · `fuse_periods` — the sizes must be equal and the periods ADJACENT for the periods to join;
//    · `split_by_size` / `split_by_epoch` — cut by size, or by period.
//    ⛔ No other combination fuses. Leaving a button alive and letting the chain refuse it leaves
//       the person having PAID GAS with no idea why. So the answer is given here, first.
//
// ⛔ The reason it cannot be done is returned with the verdict. A greyed-out button alone is a
//    shape this product has already forbidden (the final approval never stands grey and silent).

import type { StorageResource } from "./chain.ts";

/** Whether two resources can be fused, and if not, why. */
export type FuseVerdict =
  | { readonly can: true; readonly kind: "amount" | "periods" }
  | { readonly can: false; readonly why: "differentPeriod" | "differentSize" | "notAdjacent" | "same" };

/**
 * Whether the contract will fuse these two.
 *
 * ⚠ Written so the order does not matter — the order a person picks them in means nothing.
 */
export function canFuse(a: StorageResource, b: StorageResource): FuseVerdict {
  if (a.objectId === b.objectId) return { can: false, why: "same" };
  const samePeriod = a.startEpoch === b.startEpoch && a.endEpoch === b.endEpoch;
  if (samePeriod) return { can: true, kind: "amount" };
  const sameSize = a.sizeBytes === b.sizeBytes;
  if (!sameSize) return { can: false, why: "differentSize" };
  const adjacent = a.endEpoch === b.startEpoch || b.endEpoch === a.startEpoch;
  return adjacent ? { can: true, kind: "periods" } : { can: false, why: "notAdjacent" };
}

/**
 * Where a resource stands against the current epoch.
 *
 * ⛔ "Ended" is decided by COMPARING EPOCHS, not dates — the rule this product learned from its
 *    expiry display, for the same reason here.
 */
export function statusOf(
  resource: StorageResource,
  currentEpoch: number,
): "lapsed" | "notYet" | "usable" {
  if (resource.endEpoch <= currentEpoch) return "lapsed";
  if (resource.startEpoch > currentEpoch) return "notYet";
  return "usable";
}

/** Usable ones first, largest first. The order a list shows before anything else. */
export function usableFirst(
  resources: readonly StorageResource[],
  currentEpoch: number,
): StorageResource[] {
  const rank = (r: StorageResource): number =>
    ({ usable: 0, notYet: 1, lapsed: 2 })[statusOf(r, currentEpoch)];
  return [...resources].sort(
    (x, y) => rank(x) - rank(y) || y.sizeBytes - x.sizeBytes || y.endEpoch - x.endEpoch,
  );
}

/**
 * Whether a file of `encodedBytes` that must last until `needUntilEpoch` fits in this resource.
 *
 * ⚠ `encodedBytes` is the size AFTER the storage network's encoding, not the plaintext size.
 */
export function fits(resource: StorageResource, encodedBytes: number, needUntilEpoch: number): boolean {
  return resource.sizeBytes >= encodedBytes && resource.endEpoch >= needUntilEpoch;
}

/**
 * What is left of the resource after that file goes in.
 *
 * ⛔ Registration DOES NOT GIVE THE REMAINDER BACK — putting 500 MB into a 1 GB resource binds
 *    the whole gigabyte. That is why this number is shown: it is what a person chooses "cut to
 *    fit" or "use whole" on.
 */
export function leftoverBytes(resource: StorageResource, encodedBytes: number): number {
  return Math.max(0, resource.sizeBytes - encodedBytes);
}

/** The sizes of the usable resources added up — the "space held right now" line. */
export function totalUsableBytes(
  resources: readonly StorageResource[],
  currentEpoch: number,
): number {
  return resources
    .filter((r) => statusOf(r, currentEpoch) === "usable")
    .reduce((sum, r) => sum + r.sizeBytes, 0);
}

// Which company relay the treasury may tip on a credit upload (2026-11-10).
//
// WHY. Until this day a credit upload went through Mysten Labs' relay or, when it did not answer,
//   straight to the storage nodes: the treasury tipped only Mysten. The owner asked for every company
//   that answers on every road, so that a second closure still leaves a road, and Studio
//   Mirai's relay now carries credit uploads too, after Mysten and before the storage nodes.
//
// ⛔ BUT ANOTHER COMPANY NAMES THE PRICE THE TREASURY PAYS. So a relay is a credit road only while its
//   tip for THIS upload is at most `CREDIT_TIP_RATIO` times what Mysten's formula would charge for it;
//   above that the upload goes on to the next road (the storage nodes, no tip). Mysten's formula is
//   pinned, not read live: the relay is needed exactly when Mysten does not answer, and a reference
//   that has to be fetched from the company that is down is no reference.
//
// MEASURED 2026-11-10, `GET /v1/tip-config` on mainnet:
//   Mysten Labs   {"linear":{"base":0,"encoded_size_mul_per_kib":40}}
//   Studio Mirai  {"linear":{"base":3000000,"encoded_size_mul_per_kib":60}}
//   Every blob carries 66,034,000 encoded bytes even when empty (1,000 shards), so Mirai's tip is
//   2.7 times Mysten's for an empty blob and falls toward 1.5 times as the blob grows: it fits.
//
// ⚠ The chain service holds the same rule (`chain/src/limits.ts::referenceTipCeilingMist`) and refuses a
//   tip above it with 403, so a relay the browser picks and the chain refuses is a repricing between
//   the two reads, not a disagreement between two programs.
import { encodedBlobLength } from "../upload/wallet-storage-estimate.js";
/** Mysten Labs' relay tip per KiB of encoded size, MIST (base 0). ⚠ MUST match `chain/src/limits.ts::REFERENCE_TIP_PER_KIB_MIST`. */
export const REFERENCE_TIP_PER_KIB_MIST = 40;
/** How many times Mysten's formula a credit upload may tip. ⚠ MUST match `chain/src/limits.ts::CREDIT_TIP_RATIO`. */
export const CREDIT_TIP_RATIO = 3;
/** The largest blob the credit rail registers: 2,048 credits of 1 MiB (`chain/src/limits.ts` says why). */
export const LARGEST_CREDIT_BLOB_BYTES = 2 * 1024 * 1024 * 1024;
function encodedKib(blobBytes) {
    return (BigInt(encodedBlobLength(blobBytes)) + 1023n) / 1024n;
}
/** What Mysten's formula charges for a blob of `blobBytes` unencoded bytes, MIST. */
export function referenceTipMist(blobBytes) {
    return BigInt(REFERENCE_TIP_PER_KIB_MIST) * encodedKib(blobBytes);
}
/** True when this tip for a blob of `blobBytes` is one the treasury pays. */
export function creditTipFits(tip, blobBytes) {
    return tip.baseMist + tip.mulPerKibMist * encodedKib(blobBytes) <= BigInt(CREDIT_TIP_RATIO) * referenceTipMist(blobBytes);
}
/**
 * True when the tip fits at every blob size the credit rail registers. Both tips are straight lines in
 * the encoded size, so their ratio only rises or falls between the ends: checking the two ends is
 * checking every size. For a caller that chooses its road before it knows the size.
 */
export function creditTipFitsEverySize(tip) {
    return creditTipFits(tip, 0) && creditTipFits(tip, LARGEST_CREDIT_BLOB_BYTES);
}
/** A tip as a line in the encoded size, or null when the relay's price could not be read. */
export function tipLine(tip) {
    switch (tip.kind) {
        case "none":
            return { baseMist: 0n, mulPerKibMist: 0n };
        case "const":
            return { baseMist: tip.baseMist, mulPerKibMist: 0n };
        case "linear":
            return { baseMist: tip.baseMist, mulPerKibMist: tip.mulPerKibMist };
        case "unknown":
            return null;
    }
}

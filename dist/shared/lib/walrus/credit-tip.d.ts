import type { RelayTip } from "./tip-config.ts";
/** Mysten Labs' relay tip per KiB of encoded size, MIST (base 0). ⚠ MUST match `chain/src/limits.ts::REFERENCE_TIP_PER_KIB_MIST`. */
export declare const REFERENCE_TIP_PER_KIB_MIST = 40;
/** How many times Mysten's formula a credit upload may tip. ⚠ MUST match `chain/src/limits.ts::CREDIT_TIP_RATIO`. */
export declare const CREDIT_TIP_RATIO = 3;
/** The largest blob the credit rail registers: 2,048 credits of 1 MiB (`chain/src/limits.ts` says why). */
export declare const LARGEST_CREDIT_BLOB_BYTES: number;
/** A relay's tip as a line: `baseMist + mulPerKibMist × encoded KiB` (a constant tip has no slope). */
export interface TipLine {
    baseMist: bigint;
    mulPerKibMist: bigint;
}
/** What Mysten's formula charges for a blob of `blobBytes` unencoded bytes, MIST. */
export declare function referenceTipMist(blobBytes: number): bigint;
/** True when this tip for a blob of `blobBytes` is one the treasury pays. */
export declare function creditTipFits(tip: TipLine, blobBytes: number): boolean;
/**
 * True when the tip fits at every blob size the credit rail registers. Both tips are straight lines in
 * the encoded size, so their ratio only rises or falls between the ends: checking the two ends is
 * checking every size. For a caller that chooses its road before it knows the size.
 */
export declare function creditTipFitsEverySize(tip: TipLine): boolean;
/** A tip as a line in the encoded size, or null when the relay's price could not be read. */
export declare function tipLine(tip: RelayTip): TipLine | null;

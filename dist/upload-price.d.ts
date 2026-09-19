import { type PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { type PartRange } from "./shared/lib/upload/part-plan.ts";
/**
 * Storage term, in storage-network epochs.
 *
 * ⛔ NOT CHOOSABLE HERE, and that is a property of credits rather than of this tool: one credit is
 *    defined as one mebibyte for exactly this term. Offering a duration picker would be offering
 *    to spend a multiple of a unit the credit surface does not speak in. A browser's own-wallet
 *    upload has a picker because it is paying in WAL, which does divide.
 */
export declare const UPLOAD_EPOCHS = 2;
/** Bytes one credit stores for `UPLOAD_EPOCHS`. */
export declare const CREDIT_BYTES: number;
/**
 * What this upload will cost, in credits — the same arithmetic the server does.
 *
 * Printed BEFORE anything is spent so the number can be compared with what the account screen
 * shows afterwards. The server is still the authority; this is a quote, not a promise.
 */
export declare function creditsFor(sealedBytes: number, epochs?: number): number;
/**
 * How much of the file goes into one part.
 *
 * ⛔ THE SAME NUMBER ON A RESUME OR NOTHING MATCHES. The parts already written down were sealed
 *    and paid for at one size; a second run that split the file differently would be asking to
 *    push different bytes under reservations that bought the first ones. `buyAndPushPart` refuses
 *    that rather than doing it, and this is where the number comes from.
 */
export declare function partSizeFor(chosen: string | number | undefined): number;
/**
 * The plan, and what it will cost — one function so the price and the sealing cannot disagree.
 *
 * ⛔ ONLY THE LAST PART IS ROUNDED UP. The earlier ones are exactly the part size, which is what
 *    lets a reader work out where the padding is. Quoting any other way would price a file
 *    differently from how it is actually stored.
 */
export declare function planAndPrice(size: number, partSize: number, rule: PaddingRule): {
    plan: PartRange[];
    sealedBytes: number;
    credits: number;
    sealFor(range: PartRange): number;
};

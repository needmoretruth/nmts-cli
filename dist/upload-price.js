// What an upload will cost, and how the file is cut up to pay for it.
//
// ⛔ SPLIT OUT OF `put.ts` SO THAT FILE STAYS READABLE IN ONE SITTING. Everything here is
//    arithmetic over numbers — no network, no crypto, no disk beyond one `stat` — which is what
//    lets `--dry-run` answer without reading a very large file, and what lets a test drive the
//    price without an account.
import { statSync } from "node:fs";
import { NmtsError } from "./errors.js";
import { DEFAULT_PART_BYTES, NCF3_SHAPE, sealedLenFor } from "./seal.js";
import { paddedPlaintextLen } from "./shared/lib/crypto/size-padding.js";
import { planParts } from "./shared/lib/upload/part-plan.js";
/**
 * Storage term, in storage-network epochs.
 *
 * ⛔ NOT CHOOSABLE HERE, and that is a property of credits rather than of this tool: one credit is
 *    defined as one mebibyte for exactly this term. Offering a duration picker would be offering
 *    to spend a multiple of a unit the credit surface does not speak in. A browser's own-wallet
 *    upload has a picker because it is paying in WAL, which does divide.
 */
export const UPLOAD_EPOCHS = 2;
/** Bytes one credit stores for `UPLOAD_EPOCHS`. */
export const CREDIT_BYTES = 1024 * 1024;
/**
 * What this upload will cost, in credits — the same arithmetic the server does.
 *
 * Printed BEFORE anything is spent so the number can be compared with what the account screen
 * shows afterwards. The server is still the authority; this is a quote, not a promise.
 */
export function creditsFor(sealedBytes, epochs = UPLOAD_EPOCHS) {
    const mib = Math.ceil(sealedBytes / CREDIT_BYTES);
    return Math.ceil((mib * epochs) / UPLOAD_EPOCHS);
}
/**
 * How big the local file is, with the two refusals that are worth their own words.
 *
 * ⛔ IT IS NOT READ HERE. A file large enough to need several parts is a file too large to hold,
 *    and the size is all that is needed to plan the upload and quote its price. The bytes are read
 *    later, a slice at a time, by the part that is being sealed.
 */
export function measureLocal(path) {
    let stat;
    try {
        stat = statSync(path);
    }
    catch {
        throw new NmtsError(`There is no file at ${path}.`, { exitCode: 4 });
    }
    if (stat.isDirectory()) {
        throw new NmtsError(`${path} is a folder.`, {
            exitCode: 4,
            nextStep: "This version uploads one file at a time.",
        });
    }
    if (stat.size === 0) {
        throw new NmtsError(`${path} is empty.`, {
            exitCode: 4,
            nextStep: "The storage network has nothing to store and would refuse the reservation.",
        });
    }
    return stat.size;
}
/**
 * How much of the file goes into one part.
 *
 * ⛔ THE SAME NUMBER ON A RESUME OR NOTHING MATCHES. The parts already written down were sealed
 *    and paid for at one size; a second run that split the file differently would be asking to
 *    push different bytes under reservations that bought the first ones. `buyAndPushPart` refuses
 *    that rather than doing it, and this is where the number comes from.
 */
export function partSizeFor(chosen) {
    if (chosen === undefined)
        return DEFAULT_PART_BYTES;
    const bytes = typeof chosen === "number" ? chosen : parseSize(chosen);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new NmtsError(`A part size must be a positive whole number of bytes: ${String(chosen)}.`, {
            exitCode: 2,
            nextStep: "Nothing was sent. Give a number of bytes, or a number with KiB, MiB or GiB.",
        });
    }
    return bytes;
}
/**
 * A byte count, plainly or with a unit.
 *
 * ⛔ EXACT NUMBERS ARE ALWAYS ACCEPTED. The units are a convenience on top, never instead: a person
 *    who knows exactly what their machine can hold has to be able to say exactly that.
 */
function parseSize(text) {
    const match = /^(\d+)\s*(B|KiB|MiB|GiB|K|M|G)?$/i.exec(text.trim());
    if (match === null || match[1] === undefined)
        return Number.NaN;
    const scale = { b: 1, k: 2 ** 10, kib: 2 ** 10, m: 2 ** 20, mib: 2 ** 20, g: 2 ** 30, gib: 2 ** 30 };
    const unit = (match[2] ?? "B").toLowerCase();
    const factor = scale[unit];
    if (factor === undefined)
        return Number.NaN;
    return Number(match[1]) * factor;
}
/**
 * The plan, and what it will cost — one function so the price and the sealing cannot disagree.
 *
 * ⛔ ONLY THE LAST PART IS ROUNDED UP. The earlier ones are exactly the part size, which is what
 *    lets a reader work out where the padding is. Quoting any other way would price a file
 *    differently from how it is actually stored.
 */
export function planAndPrice(size, partSize, rule) {
    const plan = planParts(size, partSize);
    const sealFor = (range) => range.partIndex === plan.length - 1
        ? paddedPlaintextLen(range.length, rule, { unitBytes: CREDIT_BYTES, shape: NCF3_SHAPE })
        : range.length;
    return {
        plan,
        sealFor,
        sealedBytes: plan.reduce((sum, range) => sum + sealedLenFor(sealFor(range)), 0),
        credits: plan.reduce((sum, range) => sum + creditsFor(sealedLenFor(sealFor(range))), 0),
    };
}

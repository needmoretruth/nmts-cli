// How big a file on THIS MACHINE is — the one thing the upload price needs that a browser has no
// equivalent of.
//
// ⛔ THE ARITHMETIC IS NOT HERE. `upload-price.ts` turns a size into parts and a price and runs
//    anywhere; this is the one call that asks a disk, and it is separate so that the price is
//    reachable from a page where bytes arrive as a `Blob` and their length is already known.
import { statSync } from "node:fs";
import { NmtsError } from "./errors.js";
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

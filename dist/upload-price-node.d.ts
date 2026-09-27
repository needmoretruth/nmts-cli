/**
 * How big the local file is, with the two refusals that are worth their own words.
 *
 * ⛔ IT IS NOT READ HERE. A file large enough to need several parts is a file too large to hold,
 *    and the size is all that is needed to plan the upload and quote its price. The bytes are read
 *    later, a slice at a time, by the part that is being sealed.
 *
 * ⚠ ZERO IS A SIZE. An empty file is sealed and stored like any other (`planFor` in
 *   `upload-price.ts`), so it is not refused here.
 */
export declare function measureLocal(path: string): number;

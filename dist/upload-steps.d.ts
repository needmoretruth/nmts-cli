import { type CommitInput, type PaidPart, type UploadInput } from "./upload-wire.ts";
/** Push ONE part's bytes at the relay and report the certificate. Commits nothing. */
export declare function pushPart(input: UploadInput, step: {
    ledgerId: number;
    blobId: string;
    nonce: Uint8Array;
    registerTxDigest: string;
    blobObjectId: string;
    /** ⛔ The bytes the reservation bought — from the record on a resume. Never re-sealed ones. */
    sealed: Uint8Array;
    /** ⛔ The relay the tip was paid to. From the record on a resume. */
    relayUrl: string;
}): Promise<void>;
/**
 * Make the file real: one `POST /v1/items` naming EVERY part and the reservation that paid for it.
 *
 * ⛔ ONE CALL FOR THE WHOLE FILE. The server derives the item's size as the sum of the parts'
 *    sealed lengths and refuses a set whose indices are not a contiguous 0..n — so a file cannot
 *    be committed a piece at a time, and a part left out is not a smaller file, it is a rejection.
 *
 * ⛔ EVERY FACT HERE COMES OFF A RECORD. The parts were read back from what was written down
 *    before each reservation; the key and the content hash come from whichever record the caller
 *    read them from. A resumed run that used its own freshly generated key would produce a file
 *    that is paid for, present, correctly named — and impossible to open.
 */
export declare function commitItem(input: CommitInput, fileKey: string, parts: readonly PaidPart[]): Promise<string>;

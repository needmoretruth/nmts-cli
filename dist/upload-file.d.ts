import { type CryptoGlue } from "./crypto.ts";
import { type PaddingRule } from "./shared/lib/crypto/size-padding.ts";
import { entryOf } from "./upload.ts";
import type { BlobProtocol, PaidPart, UploadApi, UploadInput, UploadResult, UploadStep } from "./upload-wire.ts";
/**
 * Where the plaintext comes from.
 *
 * ⛔ A SEAM, NOT A CONVENIENCE. The tests drive every branch of a multi-part upload — including
 *    the ones that resume after a part was paid for — without a file and without a network. A
 *    module that opened the path itself could only be tested by writing gigabytes to a disk.
 */
export interface PlaintextSource {
    /** Total plaintext bytes. */
    size: number;
    /** Read `[offset, offset + length)`, in pieces small enough to hold. */
    read(offset: number, length: number): AsyncIterable<Uint8Array>;
}
/** Read a file off the disk, a chunk at a time. */
export declare function fileSource(path: string, size: number): PlaintextSource;
export interface FileUploadInput {
    api: UploadApi;
    protocol: BlobProtocol;
    crypt: CryptoGlue;
    /** The account's data key. Borrowed — the caller wipes it. */
    dataKey: Uint8Array;
    source: PlaintextSource;
    /** What the file is called in the account. */
    name: string;
    /** The folder id it goes in, or null for the root. */
    parentId: string | null;
    /** The destination AS TYPED. Part of the reservation key — see `upload-store.ts`. */
    destination: string;
    relayUrl: string;
    epochs: number;
    currentEpoch: number | null;
    /** How much of the file goes into one part. */
    partSize: number;
    /**
     * How coarsely the file's LAST part is rounded up before sealing, and the billing unit that
     * decides how much of that rounding is free.
     *
     * ⛔ THE ACCOUNT'S CHOICE, NOT THIS TOOL'S. A stored stream states in the clear the length it was
     *    sealed from, so without this the exact byte length of everything this tool uploads is
     *    legible to anybody who fetches it from the storage network. Rounding differently from the
     *    browser would be worse than not rounding: it would say which program uploaded the file.
     */
    padding: {
        rule: PaddingRule;
        unitBytes: number;
    };
    /**
     * How many credits this file sets aside as a deposit, 0 to 64. Absent on the wallet rail, which
     * buys its own storage and has no treasury deposit to set aside against it.
     *
     * ⛔ ONE NUMBER FOR THE WHOLE FILE, sent with every part's reservation, because the deposit is a
     *    property of the FILE the person chose it for — not of how many parts it happened to need.
     */
    depositCredits?: number;
    onStep?: (step: FileUploadStep) => void;
    /**
     * Who buys ONE part and gets its bytes onto the network. Absent = the credit rail
     * (`buyAndPushPart`); the wallet rail (`upload-wallet.ts`) supplies its own.
     *
     * ⛔ A SEAM SO THERE IS ONE FILE DRIVER. Sealing, the reservation key, the resume of a file
     *    already committed and the one-commit-per-file rule are the same whoever pays; a second
     *    driver for the wallet would be a second place for those to drift.
     */
    buy?: (input: UploadInput) => Promise<PaidPart>;
}
/** Told about each part as it starts, so a long upload visibly moves. */
export type FileUploadStep = {
    step: "planning";
    parts: number;
    partSize: number;
} | {
    step: "hashing";
    parts: number;
} | {
    step: "sealing";
    partIndex: number;
    parts: number;
    bytes: number;
} | ({
    partIndex: number;
    parts: number;
} & UploadStep);
/**
 * Upload one file and return what the caller must write into the account's file list.
 *
 * ⛔ IT DOES NOT WRITE THE FILE LIST, and the caller must — before clearing the records. A
 *    committed file the list does not name is invisible and, to the person, indistinguishable from
 *    one that never uploaded.
 */
export declare function uploadFile(input: FileUploadInput): Promise<UploadResult>;
/** The file key's records, so a caller can clear them once the list is written. */
export declare function partKeysOf(fileKey: string, parts: number): string[];
export { entryOf };

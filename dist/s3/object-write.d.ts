import { type Call } from "./call.ts";
import type { DriveWriter } from "./contract.ts";
/** S3's own ceiling on a `DeleteObjects` body. */
export declare const MAX_DELETE_BODY: number;
export declare function putObject(call: Call, writer: DriveWriter): Promise<void>;
/** `x-amz-copy-source`: `bucket/key`, percent-encoded, with or without a leading slash. */
export declare function copySourceOf(header: string): {
    bucket: string;
    key: string;
};
/**
 * `CopyObject`: the source's plaintext, fetched and stored again at this key.
 *
 * ⛔ THE SOURCE BUCKET IS ASKED ABOUT EXACTLY AS THE DESTINATION WAS — the pair's restriction
 *    first, the resolver second — or a copy would be a way to read a bucket the pair may not.
 *
 * ⛔ THE SOURCE IS READ FROM THE LIST AS IT IS NOW, not as cached: its conditions
 *    (`x-amz-copy-source-if-*`) are about the file that will be copied, and a cached list can name
 *    one that has since been replaced.
 */
export declare function copyObject(call: Call, writer: DriveWriter, header: string): Promise<void>;
export declare function deleteObject(call: Call, writer: DriveWriter): Promise<void>;
/**
 * `DeleteObjects`: up to a thousand keys in one request, each answered on its own.
 *
 * ⛔ ONE KEY'S FAILURE IS THAT KEY'S ANSWER, not the request's. S3 answers 200 with an `Error` row
 *    for the key that failed and a `Deleted` row for every other; a client retries the rows that
 *    failed. Failing the whole request for one would have it retry — and re-send — all of them.
 *
 * ⛔ THE LIST OF KEYS MUST CARRY A DIGEST, AS S3 REQUIRES. Signed as `UNSIGNED-PAYLOAD`, nothing
 *    else binds the body to the signature, and a body swapped on the way would trash files the
 *    client never named. `Content-MD5` or an `x-amz-checksum-*` is required, and the body decoder
 *    holds the bytes to it.
 */
export declare function deleteObjects(call: Call, writer: DriveWriter): Promise<void>;

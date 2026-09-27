import type { IncomingMessage } from "node:http";
import { type Readable } from "node:stream";
import { BodyRefusal } from "./body-plan.ts";
import type { ChecksumAlgorithm } from "./checksum.ts";
import type { VerifiedAgainst } from "./sigv4.ts";
export { BodyRefusal } from "./body-plan.ts";
/** A request body, decoded. */
export interface DecodedBody {
    /** The object's bytes, with any `aws-chunked` framing removed. */
    readonly stream: Readable;
    /**
     * How many bytes the object will have: `x-amz-decoded-content-length` for a framed body,
     * `content-length` otherwise. Null when the request declared neither.
     */
    readonly size: number | null;
    /**
     * Resolves once the whole body has been read and every rule the request carried held: the signed
     * payload digest, each chunk signature, the trailing or header checksum, `Content-MD5`.
     * Rejects with a `BodyRefusal` otherwise.
     */
    readonly verified: Promise<void>;
    /**
     * The `x-amz-checksum-*` values the body was held to, from its headers or its trailer, once
     * `verified` has resolved; empty before then. A piece of a multipart upload keeps them, so the
     * finish can be checked against them.
     */
    readonly checksums?: () => ReadonlyMap<ChecksumAlgorithm, Buffer>;
}
/** How one request's body is read. */
export interface DecodeOptions {
    /**
     * `x-amz-checksum-*` headers describe the OBJECT the request makes, not this body — true of
     * `CompleteMultipartUpload`, whose body is the part list. They are then left to the caller
     * rather than held against the body, which they would never match.
     */
    readonly checksumsDescribeObject?: boolean;
}
/**
 * Decode one request body, or say at once why it cannot be.
 *
 * ⚠ THE STREAM MUST BE READ. It is fed as the request arrives and pauses the request when nobody
 *   reads it, so a caller that awaits `verified` without consuming `stream` waits forever.
 */
export declare function decodeBody(req: IncomingMessage, verdict: Extract<VerifiedAgainst, {
    ok: true;
}>, options?: DecodeOptions): DecodedBody | BodyRefusal;

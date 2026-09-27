import type { IncomingMessage } from "node:http";
import { type ChecksumAlgorithm } from "./checksum.ts";
import { type SigningContext, type VerifiedAgainst } from "./sigv4.ts";
/** Why a body cannot be used, as the S3 error a client expects. */
export declare class BodyRefusal extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export type Framing = "plain" | "signed" | "signed-trailer" | "unsigned-trailer";
/** Everything the headers promised, read before the first byte of the body. */
export interface Plan {
    readonly framing: Framing;
    readonly size: number;
    /** The hex SHA-256 a plain body was signed with; null for `UNSIGNED-PAYLOAD` and framed bodies. */
    readonly payloadDigest: string | null;
    readonly contentMd5: Buffer | null;
    /** `x-amz-checksum-*` values that arrived as headers. */
    readonly headerChecksums: ReadonlyMap<ChecksumAlgorithm, Buffer>;
    /** The checksums `x-amz-trailer` says will follow the last chunk. */
    readonly trailers: readonly ChecksumAlgorithm[];
    readonly signing: SigningContext;
}
export declare function invalid(message: string): BodyRefusal;
export declare function incomplete(message: string): BodyRefusal;
/** Read every promise the headers make, or say which one cannot be kept. */
export declare function planOf(req: IncomingMessage, verdict: Extract<VerifiedAgainst, {
    ok: true;
}>, 
/** `x-amz-checksum-*` headers are the object's, not this body's, and are not held against it. */
checksumsDescribeObject?: boolean): Plan | BodyRefusal;

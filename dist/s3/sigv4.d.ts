import { type AuthorizationParts, type IncomingRequest } from "./sigv4-canonical.ts";
export { amzDateToMs, canonicalQuery, isPayloadHash, STREAMING_PAYLOAD, STREAMING_PAYLOAD_TRAILER, STREAMING_UNSIGNED_PAYLOAD_TRAILER, UNSIGNED_PAYLOAD, } from "./sigv4-canonical.ts";
export type { IncomingRequest } from "./sigv4-canonical.ts";
export { MAX_PRESIGNED_EXPIRY_SECONDS } from "./sigv4-presigned.ts";
/** How far a request's own timestamp may sit from ours before it is refused. AWS uses the same. */
export declare const MAX_CLOCK_SKEW_MS: number;
export interface GatewayCredential {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    /**
     * The only buckets this pair may touch. Absent means every bucket the gateway serves.
     *
     * ⛔ IT IS WHAT KEEPS ONE CUSTOMER'S KEY OFF ANOTHER CUSTOMER'S BUCKET. A gateway in front of
     *    many accounts hands each caller its own pair, and without this every pair would open every
     *    account the resolver knows.
     */
    readonly buckets?: readonly string[] | undefined;
}
/**
 * What a chunk-signed body needs to go on checking the request's signature: every chunk signature
 * is an HMAC under the same key, over a string that names the same timestamp and scope and the
 * signature before it -- starting from the request's own.
 */
export interface SigningContext {
    /** The key derived for this request's date, region and service. */
    readonly key: Buffer;
    /** `20130524/us-east-1/s3/aws4_request`. */
    readonly scope: string;
    /** The request's timestamp, `20130524T000000Z`. */
    readonly stamp: string;
    /** The request's signature, which the first chunk signature chains from. */
    readonly seedSignature: string;
}
export type Verified = {
    readonly ok: true;
    readonly payloadHash: string;
    readonly signing: SigningContext;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** What `verifyAgainst` answers: the same verdict, plus which of the pairs signed. */
export type VerifiedAgainst = {
    readonly ok: true;
    readonly payloadHash: string;
    readonly signing: SigningContext;
    readonly credential: GatewayCredential;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** Pull apart `AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`. */
export declare function parseAuthorization(header: string | undefined): AuthorizationParts | null;
/**
 * Rebuild the string the client signed and check that the signature matches -- in the
 * `Authorization` header or in a presigned query, whichever the request carries.
 *
 * The clock is passed in rather than read here: a test that cannot choose "now" cannot check the
 * skew rule at all, and that rule is the one that stops a captured request being replayed tomorrow.
 */
export declare function verifySignature(request: IncomingRequest, credential: GatewayCredential, now: number): Verified;
/**
 * The whole check, against every pair a gateway answers to: which one signed, and whether it did.
 *
 * ⚠ THE THREE REFUSALS ARE DIFFERENT ON PURPOSE. "No signature at all", "a key this gateway does
 *   not have" and "a signature that does not hold" are three different things for whoever is
 *   reading a client's logs, and none of them says anything about what is in the drive.
 */
export declare function verifyAgainst(request: IncomingRequest, credentials: readonly GatewayCredential[], now: number): VerifiedAgainst;

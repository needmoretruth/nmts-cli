/** How far a request's own timestamp may sit from ours before it is refused. AWS uses the same. */
export declare const MAX_CLOCK_SKEW_MS: number;
/** The literals a client may put in `x-amz-content-sha256` instead of a hex digest. */
export declare const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export declare const STREAMING_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export declare const STREAMING_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
export interface IncomingRequest {
    readonly method: string;
    /** Raw request target, path and query together, exactly as it came off the wire. */
    readonly url: string;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}
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
export type Verified = {
    readonly ok: true;
    readonly payloadHash: string;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** What `verifyAgainst` answers: the same verdict, plus which of the pairs signed. */
export type VerifiedAgainst = {
    readonly ok: true;
    readonly payloadHash: string;
    readonly credential: GatewayCredential;
} | {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** `k=v&k2=v2` in the order AWS wants: encoded, sorted by key and then by value. */
export declare function canonicalQuery(rawQuery: string): string;
interface AuthorizationParts {
    readonly accessKeyId: string;
    readonly date: string;
    readonly region: string;
    readonly service: string;
    readonly signedHeaders: readonly string[];
    readonly signature: string;
}
/** Pull apart `AWS4-HMAC-SHA256 Credential=…, SignedHeaders=…, Signature=…`. */
export declare function parseAuthorization(header: string | undefined): AuthorizationParts | null;
/** `20260824T232759Z` → epoch milliseconds, or null if it is not that shape. */
export declare function amzDateToMs(stamp: string | undefined): number | null;
/**
 * Rebuild the string the client signed and check that the signature matches.
 *
 * The clock is passed in rather than read here: a test that cannot choose "now" cannot check the
 * skew rule at all, and that rule is the one that stops a captured request being replayed tomorrow.
 */
export declare function verifySignature(request: IncomingRequest, credential: GatewayCredential, now: number): Verified;
/**
 * The whole check, against every pair a gateway answers to: which one signed, and whether it did.
 *
 * ⚠ THE THREE REFUSALS ARE DIFFERENT ON PURPOSE. "No authorization header at all", "a key this
 *   gateway does not have" and "a signature that does not hold" are three different things for
 *   whoever is reading a client's logs, and none of them says anything about what is in the drive.
 */
export declare function verifyAgainst(request: IncomingRequest, credentials: readonly GatewayCredential[], now: number): VerifiedAgainst;
export {};

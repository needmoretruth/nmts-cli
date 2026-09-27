/** The literals a client may put in `x-amz-content-sha256` instead of a hex digest. */
export declare const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export declare const STREAMING_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export declare const STREAMING_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
export declare const STREAMING_UNSIGNED_PAYLOAD_TRAILER = "STREAMING-UNSIGNED-PAYLOAD-TRAILER";
export interface IncomingRequest {
    readonly method: string;
    /** Raw request target, path and query together, exactly as it came off the wire. */
    readonly url: string;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}
export type Refusal = {
    readonly ok: false;
    readonly code: string;
    readonly message: string;
};
/** One refusal, shaped so it satisfies both verdict types — neither of which has an `ok: true`. */
export declare function refuse(code: string, message: string): Refusal;
export declare function headerValue(headers: IncomingRequest["headers"], name: string): string | undefined;
/**
 * Whether `x-amz-content-sha256` holds something S3 accepts: a lowercase hex SHA-256, or one of
 * the four literals.
 *
 * ⛔ ANYTHING ELSE IS REFUSED BEFORE THE BODY IS TOUCHED. The value decides how the body is read --
 *    as it is, or with `aws-chunked` framing to take off -- and a value this gateway does not know
 *    would leave that to a guess.
 */
export declare function isPayloadHash(value: string): boolean;
export interface QueryPart {
    readonly key: string;
    readonly value: string;
}
/** The query's parts, decoded. Throws `URIError` on a broken percent escape. */
export declare function queryParts(rawQuery: string): QueryPart[];
export declare function canonicalOf(parts: readonly QueryPart[]): string;
/** `k=v&k2=v2` in the order AWS wants: encoded, sorted by key and then by value. */
export declare function canonicalQuery(rawQuery: string): string;
export interface AuthorizationParts {
    readonly accessKeyId: string;
    readonly date: string;
    readonly region: string;
    readonly service: string;
    readonly signedHeaders: readonly string[];
    readonly signature: string;
}
export type ScopeParts = Pick<AuthorizationParts, "accessKeyId" | "date" | "region" | "service">;
/** `AKID/20130524/us-east-1/s3/aws4_request` → its four named parts, or null. */
export declare function parseCredentialScope(credential: string): ScopeParts | null;
/**
 * What is wrong with a credential scope's date, region and service, or null when nothing is.
 *
 * ⛔ THE SCOPE IS WHAT THE SIGNING KEY IS DERIVED FROM, SO A LOOSE ONE IS A KEY NOBODY MEANT. An
 *    empty date, or one that is not the request's own day, signs a request under a key that is not
 *    that day's; a service other than `s3` signs it under a key meant for another API. S3 refuses
 *    both, and so does this. ⚠ The region is not checked against anything: this gateway has none
 *    of its own and answers whichever one a client was configured with, as long as it names one.
 *    Whether the date is the request's day is checked where the timestamp is known, in `sigv4.ts`.
 */
export declare function scopeProblem(scope: ScopeParts): string | null;
/**
 * The headers S3 requires a signature to cover that this one leaves out: `host`, and every
 * `x-amz-*` header the request carries. Sorted, lowercase; empty when there are none.
 *
 * ⛔ A HEADER THE SIGNATURE DOES NOT COVER IS ONE ANYBODY ON THE WAY CAN ADD. The operations act on
 *    headers -- `x-amz-copy-source` turns an upload into a copy of another file, and a presigned
 *    URL for "upload here" signs only its host. Without this rule whoever held that URL could add
 *    the header and read a file the signer never named, in a bucket the signer's pair may touch:
 *    for a business that presigns for all of its customers with one pair, any customer's file.
 *    `host` is required for the same reason in the other direction: a signature that does not name
 *    the host it was made for is one that can be replayed against any other.
 *
 * ⚠ TWO ARE EXEMPT BECAUSE THE SIGNATURE COVERS THEIR VALUE ANOTHER WAY, which is also why S3's
 *   own clients leave them out of a presigned URL. `x-amz-content-sha256` is the last line of the
 *   canonical request in both forms; `x-amz-date` is the timestamp in the string to sign -- in the
 *   header form only, since a presigned URL carries its date in the query and reads no header.
 */
export declare function unsignedHeaders(request: IncomingRequest, presented: Presented): string[];
export declare function signingKey(secret: string, date: string, region: string, service: string): Buffer;
/** `20260824T232759Z` → epoch milliseconds, or null if it is not that shape. */
export declare function amzDateToMs(stamp: string | undefined): number | null;
/** A signature as the request presented it, read from the header or from a presigned query. */
export interface Presented extends AuthorizationParts {
    /** The request's timestamp: `x-amz-date`, or `X-Amz-Date` for a presigned URL. */
    readonly stamp: string | undefined;
    /** A presigned URL's lifetime in seconds; null for the header form, which has none. */
    readonly expiresSeconds: number | null;
    /** The query as it enters the canonical request -- for a presigned URL, without its signature. */
    readonly canonicalQuery: string;
    /** The declared payload hash; undefined when the header form left it out. */
    readonly payloadHash: string | undefined;
}

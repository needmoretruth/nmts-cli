// The parts of Signature Version 4 that both ways of carrying a signature share: the payload
// literals, RFC 3986 encoding and the canonical query, the credential scope, the signing key and the
// timestamp. One of the parts of `sigv4.ts`, which re-exports what callers use; only it and
// `sigv4-presigned.ts` import this.
import { createHmac } from "node:crypto";
/** The literals a client may put in `x-amz-content-sha256` instead of a hex digest. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
export const STREAMING_PAYLOAD = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD";
export const STREAMING_PAYLOAD_TRAILER = "STREAMING-AWS4-HMAC-SHA256-PAYLOAD-TRAILER";
export const STREAMING_UNSIGNED_PAYLOAD_TRAILER = "STREAMING-UNSIGNED-PAYLOAD-TRAILER";
/** One refusal, shaped so it satisfies both verdict types — neither of which has an `ok: true`. */
export function refuse(code, message) {
    return { ok: false, code, message };
}
export function headerValue(headers, name) {
    const raw = headers[name];
    if (raw === undefined)
        return undefined;
    return Array.isArray(raw) ? raw.join(",") : String(raw);
}
/**
 * Whether `x-amz-content-sha256` holds something S3 accepts: a lowercase hex SHA-256, or one of
 * the four literals.
 *
 * ⛔ ANYTHING ELSE IS REFUSED BEFORE THE BODY IS TOUCHED. The value decides how the body is read --
 *    as it is, or with `aws-chunked` framing to take off -- and a value this gateway does not know
 *    would leave that to a guess.
 */
export function isPayloadHash(value) {
    return (/^[0-9a-f]{64}$/.test(value) ||
        value === UNSIGNED_PAYLOAD ||
        value === STREAMING_PAYLOAD ||
        value === STREAMING_PAYLOAD_TRAILER ||
        value === STREAMING_UNSIGNED_PAYLOAD_TRAILER);
}
/**
 * RFC 3986 encoding, which is what SigV4 means by "URI-encode".
 *
 * ⚠ `encodeURIComponent` leaves `!'()*` alone and AWS does not, so those four are finished by hand.
 * A query string that contains one of them and is encoded the JavaScript way produces a different
 * canonical request from the client's, and the request is refused for no reason a person can see.
 */
function uriEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
/** The query's parts, decoded. Throws `URIError` on a broken percent escape. */
export function queryParts(rawQuery) {
    const parts = [];
    for (const raw of rawQuery.split("&")) {
        if (raw.length === 0)
            continue;
        const at = raw.indexOf("=");
        const key = at < 0 ? raw : raw.slice(0, at);
        const value = at < 0 ? "" : raw.slice(at + 1);
        parts.push({ key: decodeURIComponent(key), value: decodeURIComponent(value) });
    }
    return parts;
}
export function canonicalOf(parts) {
    const pairs = parts.map((p) => [uriEncode(p.key), uriEncode(p.value)]);
    pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}
/** `k=v&k2=v2` in the order AWS wants: encoded, sorted by key and then by value. */
export function canonicalQuery(rawQuery) {
    if (rawQuery.length === 0)
        return "";
    return canonicalOf(queryParts(rawQuery));
}
/** `AKID/20130524/us-east-1/s3/aws4_request` → its four named parts, or null. */
export function parseCredentialScope(credential) {
    const scope = credential.split("/");
    if (scope.length !== 5 || scope[4] !== "aws4_request")
        return null;
    const [accessKeyId, date, region, service] = scope;
    if (accessKeyId === undefined || date === undefined || region === undefined || service === undefined) {
        return null;
    }
    return { accessKeyId, date, region, service };
}
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
export function scopeProblem(scope) {
    if (!/^\d{8}$/.test(scope.date))
        return "the credential's date is not eight digits, YYYYMMDD";
    if (scope.region.length === 0)
        return "the credential names no region";
    if (scope.service !== "s3")
        return 'the credential is scoped to a service other than "s3"';
    return null;
}
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
export function unsignedHeaders(request, presented) {
    const signed = new Set(presented.signedHeaders);
    const missing = new Set();
    if (!signed.has("host"))
        missing.add("host");
    for (const raw of Object.keys(request.headers)) {
        const name = raw.toLowerCase();
        if (!name.startsWith("x-amz-") || signed.has(name))
            continue;
        if (name === "x-amz-content-sha256")
            continue;
        if (name === "x-amz-date" && presented.expiresSeconds === null)
            continue;
        missing.add(name);
    }
    return [...missing].sort();
}
export function signingKey(secret, date, region, service) {
    const kDate = createHmac("sha256", `AWS4${secret}`).update(date).digest();
    const kRegion = createHmac("sha256", kDate).update(region).digest();
    const kService = createHmac("sha256", kRegion).update(service).digest();
    return createHmac("sha256", kService).update("aws4_request").digest();
}
/** `20260824T232759Z` → epoch milliseconds, or null if it is not that shape. */
export function amzDateToMs(stamp) {
    if (stamp === undefined)
        return null;
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
    if (m === null)
        return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

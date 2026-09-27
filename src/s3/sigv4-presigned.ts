// A presigned URL: the signature read out of the query string instead of an `Authorization` header.
// One of the parts of `sigv4.ts`; only it imports this.
//
// ⛔ WHAT IS READ HERE IS WHERE THE PARTS ARE, NOT WHETHER THEY HOLD. Whether the signature holds is
//    judged in `sigv4.ts`, by the same code for both forms. Whether the URL is still alive is judged
//    there too, next to the clock-skew rule it bends.

import {
  canonicalOf,
  headerValue,
  parseCredentialScope,
  refuse,
  scopeProblem,
  UNSIGNED_PAYLOAD,
  type IncomingRequest,
  type Presented,
  type QueryPart,
  type Refusal,
} from "./sigv4-canonical.ts";

/** The longest a presigned URL may live: seven days, which is S3's own ceiling. */
export const MAX_PRESIGNED_EXPIRY_SECONDS = 604_800;

/** The names of a presigned URL's parts. Case matters: S3 reads them exactly so. */
const Q_ALGORITHM = "X-Amz-Algorithm";
const Q_CREDENTIAL = "X-Amz-Credential";
const Q_DATE = "X-Amz-Date";
const Q_EXPIRES = "X-Amz-Expires";
const Q_SIGNED_HEADERS = "X-Amz-SignedHeaders";
const Q_SIGNATURE = "X-Amz-Signature";
const Q_SESSION = "X-Amz-Security-Token";

/** Whether the query carries a signature, which makes the request a presigned one. */
export function isPresigned(parts: readonly QueryPart[]): boolean {
  return parts.some((p) => p.key === Q_ALGORITHM || p.key === Q_CREDENTIAL || p.key === Q_SIGNATURE);
}

/**
 * Read a presigned URL's parts out of its query.
 *
 * ⚠ THE PAYLOAD HASH IS `UNSIGNED-PAYLOAD` UNLESS THE CLIENT SAID OTHERWISE, as a header or --
 *   which is what the AWS SDK for JavaScript does -- as an `X-Amz-Content-Sha256` query parameter.
 *   A presigned URL is made before anybody knows what will be uploaded through it.
 */
export function presentedFromQuery(request: IncomingRequest, parts: readonly QueryPart[]): Presented | Refusal {
  const malformed = (message: string): Refusal => refuse("AuthorizationQueryParametersError", message);
  const names = [Q_ALGORITHM, Q_CREDENTIAL, Q_DATE, Q_EXPIRES, Q_SIGNED_HEADERS, Q_SIGNATURE, Q_SESSION];
  if (names.some((name) => parts.filter((p) => p.key === name).length > 1)) {
    return malformed("a presigned URL names one of its X-Amz-* parameters more than once");
  }
  const single = (name: string): string | undefined => parts.find((p) => p.key === name)?.value;

  const algorithm = single(Q_ALGORITHM);
  const credential = single(Q_CREDENTIAL);
  const stamp = single(Q_DATE);
  const expires = single(Q_EXPIRES);
  const signedHeaders = single(Q_SIGNED_HEADERS);
  const signature = single(Q_SIGNATURE);
  const token = single(Q_SESSION);
  if (algorithm !== "AWS4-HMAC-SHA256") return malformed("X-Amz-Algorithm must be AWS4-HMAC-SHA256");
  if (
    credential === undefined ||
    stamp === undefined ||
    expires === undefined ||
    signedHeaders === undefined ||
    signature === undefined
  ) {
    return malformed(
      "a presigned URL needs X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-SignedHeaders and X-Amz-Signature",
    );
  }
  // ⛔ NO SESSION TOKENS. This gateway hands out plain pairs and nothing else, so a URL signed with
  //    temporary credentials was not signed with one of them, whatever the signature says.
  if (token !== undefined) {
    return refuse("InvalidToken", "this gateway issues no session tokens, so X-Amz-Security-Token cannot be honoured");
  }
  const scope = parseCredentialScope(credential);
  if (scope === null) return malformed("X-Amz-Credential is not <key>/<date>/<region>/<service>/aws4_request");
  const problem = scopeProblem(scope);
  if (problem !== null) return malformed(`X-Amz-Credential is malformed: ${problem}`);
  if (!/^\d{1,7}$/.test(expires)) return malformed("X-Amz-Expires must be a whole number of seconds");
  const expiresSeconds = Number(expires);
  if (expiresSeconds < 1 || expiresSeconds > MAX_PRESIGNED_EXPIRY_SECONDS) {
    return malformed(`X-Amz-Expires must be between 1 and ${MAX_PRESIGNED_EXPIRY_SECONDS} seconds`);
  }

  const declared = parts.filter((p) => p.key.toLowerCase() === "x-amz-content-sha256");
  if (declared.length > 1) return malformed("X-Amz-Content-Sha256 appears more than once");
  const payloadHash =
    headerValue(request.headers, "x-amz-content-sha256") ?? declared[0]?.value ?? UNSIGNED_PAYLOAD;

  return {
    ...scope,
    signedHeaders: signedHeaders.split(";").filter((h) => h.length > 0),
    signature,
    stamp,
    expiresSeconds,
    canonicalQuery: canonicalOf(parts.filter((p) => p.key !== Q_SIGNATURE)),
    payloadHash,
  };
}

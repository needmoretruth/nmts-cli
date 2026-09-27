import { type IncomingRequest, type Presented, type QueryPart, type Refusal } from "./sigv4-canonical.ts";
/** The longest a presigned URL may live: seven days, which is S3's own ceiling. */
export declare const MAX_PRESIGNED_EXPIRY_SECONDS = 604800;
/** Whether the query carries a signature, which makes the request a presigned one. */
export declare function isPresigned(parts: readonly QueryPart[]): boolean;
/**
 * Read a presigned URL's parts out of its query.
 *
 * ⚠ THE PAYLOAD HASH IS `UNSIGNED-PAYLOAD` UNLESS THE CLIENT SAID OTHERWISE, as a header or --
 *   which is what the AWS SDK for JavaScript does -- as an `X-Amz-Content-Sha256` query parameter.
 *   A presigned URL is made before anybody knows what will be uploaded through it.
 */
export declare function presentedFromQuery(request: IncomingRequest, parts: readonly QueryPart[]): Presented | Refusal;

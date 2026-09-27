import { type Call } from "./call.ts";
import type { Staging } from "./staging.ts";
/** S3's own ceiling, and a bound on what one client can stage on this machine. */
export declare const MAX_PARTS = 10000;
/** Ten thousand parts, each with its tag and checksums, fit well inside this. */
export declare const MAX_COMPLETE_BODY: number;
/** The most rows one listing answers — S3's number for both. */
export declare const MAX_LISTED = 1000;
export declare function beginUpload(call: Call, staging: Staging): Promise<void>;
export declare function uploadPart(call: Call, staging: Staging, uploadId: string, maxObjectBytes?: number): Promise<void>;
export declare function completeUpload(call: Call, staging: Staging, uploadId: string): Promise<void>;
export declare function abortUpload(call: Call, staging: Staging, uploadId: string): Promise<void>;
/** `ListParts`: the pieces of one upload, a page at a time. */
export declare function listParts(call: Call, staging: Staging | undefined, uploadId: string): Promise<void>;
/**
 * `ListMultipartUploads`: every upload begun here and not yet finished or aborted.
 *
 * ⚠ A READ-ONLY DRIVE HAS NONE, and says so with an empty list rather than a refusal: the question
 *   has a true answer, and `rclone cleanup` asks it before deciding there is nothing to clean.
 *
 * ⛔ PAGED OVER ROWS, NOT UPLOADS. A common prefix is one row however many uploads it stands for,
 *    and the next page resumes after the last row answered — the prefix itself, when that is what
 *    it was, so none of the uploads it stood for come back on the next page as if new. And one
 *    key's uploads resume after the marker's id whether or not that upload still exists: ids sort
 *    by when they began (`staging.ts`), so an upload finished between two pages costs the listing
 *    nothing.
 */
export declare function listUploads(call: Call, staging: Staging | undefined): Promise<void>;

import type { IncomingMessage } from "node:http";
import type { DriveObject } from "./listing.ts";
/** What a write says the key must hold when it lands. */
export interface WriteCondition {
    /** `If-Match`: the tag (or tags, or `*`) the key must hold. Null when absent. */
    readonly ifMatch: string | null;
    /** `If-None-Match: *`: the key must hold nothing. */
    readonly ifNoneMatch: boolean;
}
export declare const UNCONDITIONAL: WriteCondition;
/** The conditions a copy puts on its SOURCE. Times are whole seconds, as an HTTP date carries. */
export interface CopySourceCondition {
    readonly ifMatch: string | null;
    readonly ifNoneMatch: string | null;
    readonly ifModifiedSince: number | null;
    readonly ifUnmodifiedSince: number | null;
}
/**
 * Refuse a request that carries a condition, for an operation that honours none.
 *
 * ⚠ `UploadPart`, `CreateMultipartUpload`, `AbortMultipartUpload` and `DeleteObjects` take no
 *   conditions in S3 either; a client that sends one anyway is told so rather than answered as if
 *   it had held.
 */
export declare function refuseConditions(req: IncomingMessage, operation: string): void;
/** What `If-Match` and `If-None-Match` ask of a write's destination. */
export declare function writeConditionOf(req: IncomingMessage, operation: string): WriteCondition;
/**
 * What a `DeleteObject` asks: `If-Match` is honoured; the rest of S3's conditions on a delete are
 * refused, since nothing here can judge them.
 */
export declare function deleteConditionOf(req: IncomingMessage): WriteCondition;
/**
 * Whether what stands at the key now meets the condition. Throws 412 when it does not, and 404 for
 * `If-Match` on a key that holds nothing — S3's two answers.
 */
export declare function checkWriteCondition(standing: DriveObject | undefined, condition: WriteCondition): void;
/** The four `x-amz-copy-source-if-*` headers. */
export declare function copySourceConditionOf(req: IncomingMessage): CopySourceCondition;
/**
 * Whether a copy's source meets its conditions. Throws 412 when it does not.
 *
 * ⚠ S3'S PAIRINGS: a matching `if-match` copies whatever `if-unmodified-since` says, and a failing
 *   `if-none-match` refuses whatever `if-modified-since` says — each tag condition, when present,
 *   decides in place of its date.
 */
export declare function checkCopySource(object: DriveObject, condition: CopySourceCondition): void;

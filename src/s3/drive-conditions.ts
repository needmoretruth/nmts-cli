// What a write asks of the key before it will happen: `If-Match` and `If-None-Match` on an upload,
// a finish, a copy's destination or a delete, and the four `x-amz-copy-source-if-*` on a copy's
// source.
//
// ⛔ A CONDITION THIS GATEWAY CANNOT HONOUR IS REFUSED WITH 501, NEVER IGNORED. A client that sends
//    `If-None-Match: *` is relying on it to stop two writers overwriting each other; answering 200
//    while ignoring it tells that client the one thing that did not happen.
//
// ⛔ JUDGED AGAINST THE LIST READ INSIDE THE KEY'S LOCK (`drive-lock.ts`), where the drive decides
//    the write. A check made earlier, on a list cached for seconds, only lets an answer that is
//    already known keep its own status; it is never the one that decides.

import type { IncomingMessage } from "node:http";

import { S3Refusal } from "./answer.ts";
import { headerOf } from "./call.ts";
import type { DriveObject } from "./listing.ts";

/** What a write says the key must hold when it lands. */
export interface WriteCondition {
  /** `If-Match`: the tag (or tags, or `*`) the key must hold. Null when absent. */
  readonly ifMatch: string | null;
  /** `If-None-Match: *`: the key must hold nothing. */
  readonly ifNoneMatch: boolean;
}

export const UNCONDITIONAL: WriteCondition = { ifMatch: null, ifNoneMatch: false };

/** The conditions a copy puts on its SOURCE. Times are whole seconds, as an HTTP date carries. */
export interface CopySourceCondition {
  readonly ifMatch: string | null;
  readonly ifNoneMatch: string | null;
  readonly ifModifiedSince: number | null;
  readonly ifUnmodifiedSince: number | null;
}

function notHonoured(header: string, operation: string): S3Refusal {
  return new S3Refusal(501, "NotImplemented", `This gateway does not honour ${header} on ${operation}. Nothing was changed.`);
}

function preconditionFailed(): S3Refusal {
  return new S3Refusal(412, "PreconditionFailed", "At least one of the preconditions you specified did not hold.");
}

function bareTag(tag: string): string {
  return tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

/** Whether a list of tags in a header names this one. `*` names any object that exists. */
function tagListHas(header: string, etag: string): boolean {
  const mine = bareTag(etag);
  return header.split(",").some((tag) => tag.trim() === "*" || bareTag(tag) === mine);
}

/** The HTTP conditions a request carries. */
const CONDITIONAL = ["if-match", "if-none-match", "if-modified-since", "if-unmodified-since"];

/**
 * Refuse a request that carries a condition, for an operation that honours none.
 *
 * ⚠ `UploadPart`, `CreateMultipartUpload`, `AbortMultipartUpload` and `DeleteObjects` take no
 *   conditions in S3 either; a client that sends one anyway is told so rather than answered as if
 *   it had held.
 */
export function refuseConditions(req: IncomingMessage, operation: string): void {
  for (const name of CONDITIONAL) {
    if (headerOf(req, name) !== undefined) throw notHonoured(name, operation);
  }
}

/** What `If-Match` and `If-None-Match` ask of a write's destination. */
export function writeConditionOf(req: IncomingMessage, operation: string): WriteCondition {
  for (const name of ["if-modified-since", "if-unmodified-since"]) {
    if (headerOf(req, name) !== undefined) throw notHonoured(name, operation);
  }
  const noneMatch = headerOf(req, "if-none-match")?.trim();
  if (noneMatch !== undefined && noneMatch !== "*") throw notHonoured("If-None-Match other than `*`", operation);
  const match = headerOf(req, "if-match")?.trim();
  return { ifMatch: match === undefined || match === "" ? null : match, ifNoneMatch: noneMatch === "*" };
}

/**
 * What a `DeleteObject` asks: `If-Match` is honoured; the rest of S3's conditions on a delete are
 * refused, since nothing here can judge them.
 */
export function deleteConditionOf(req: IncomingMessage): WriteCondition {
  for (const name of [
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
    "x-amz-if-match-last-modified-time",
    "x-amz-if-match-size",
  ]) {
    if (headerOf(req, name) !== undefined) throw notHonoured(name, "DeleteObject");
  }
  const match = headerOf(req, "if-match")?.trim();
  return { ifMatch: match === undefined || match === "" ? null : match, ifNoneMatch: false };
}

/**
 * Whether what stands at the key now meets the condition. Throws 412 when it does not, and 404 for
 * `If-Match` on a key that holds nothing — S3's two answers.
 */
export function checkWriteCondition(standing: DriveObject | undefined, condition: WriteCondition): void {
  if (condition.ifNoneMatch && standing !== undefined) throw preconditionFailed();
  if (condition.ifMatch !== null) {
    if (standing === undefined) {
      throw new S3Refusal(404, "NoSuchKey", "If-Match names a tag, and nothing is at that key. Nothing was changed.");
    }
    if (!tagListHas(condition.ifMatch, standing.etag)) throw preconditionFailed();
  }
}

/** An HTTP date as whole seconds. An unreadable one is refused: a condition nobody can read is not held. */
function secondsOf(name: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new S3Refusal(400, "InvalidArgument", `${name} is not a date.`);
  return Math.floor(ms / 1000);
}

/** The four `x-amz-copy-source-if-*` headers. */
export function copySourceConditionOf(req: IncomingMessage): CopySourceCondition {
  const tag = (name: string): string | null => {
    const value = headerOf(req, name)?.trim();
    return value === undefined || value === "" ? null : value;
  };
  return {
    ifMatch: tag("x-amz-copy-source-if-match"),
    ifNoneMatch: tag("x-amz-copy-source-if-none-match"),
    ifModifiedSince: secondsOf("x-amz-copy-source-if-modified-since", headerOf(req, "x-amz-copy-source-if-modified-since")),
    ifUnmodifiedSince: secondsOf(
      "x-amz-copy-source-if-unmodified-since",
      headerOf(req, "x-amz-copy-source-if-unmodified-since"),
    ),
  };
}

/**
 * Whether a copy's source meets its conditions. Throws 412 when it does not.
 *
 * ⚠ S3'S PAIRINGS: a matching `if-match` copies whatever `if-unmodified-since` says, and a failing
 *   `if-none-match` refuses whatever `if-modified-since` says — each tag condition, when present,
 *   decides in place of its date.
 */
export function checkCopySource(object: DriveObject, condition: CopySourceCondition): void {
  const changed = Math.floor(object.entry.updatedAt / 1000);
  if (condition.ifMatch !== null) {
    if (!tagListHas(condition.ifMatch, object.etag)) throw preconditionFailed();
  } else if (condition.ifUnmodifiedSince !== null && changed > condition.ifUnmodifiedSince) {
    throw preconditionFailed();
  }
  if (condition.ifNoneMatch !== null) {
    if (tagListHas(condition.ifNoneMatch, object.etag)) throw preconditionFailed();
  } else if (condition.ifModifiedSince !== null && changed <= condition.ifModifiedSince) {
    throw preconditionFailed();
  }
}

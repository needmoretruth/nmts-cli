// One request as the operations see it: already signed for, already addressed, its drive resolved.
//
// ⚠ EVERYTHING HERE HAS BEEN DECIDED BY `routes.ts` BEFORE AN OPERATION RUNS — who signed, which
//   bucket and key, and that the pair may touch that bucket. An operation that needs a second
//   bucket (a copy's source) asks `mayTouch` itself, and asks it before the resolver, for the
//   reason `NOT_YOURS` gives.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { DriveSource, GatewayOptions, WriteMeta } from "./contract.ts";
import type { GatewayCredential, VerifiedAgainst } from "./sigv4.ts";

export interface Call {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly query: URLSearchParams;
  readonly bucket: string;
  readonly key: string;
  /** The path as it arrived, which is what an error document names as its resource. */
  readonly resource: string;
  readonly verdict: Extract<VerifiedAgainst, { ok: true }>;
  readonly options: GatewayOptions;
  readonly source: DriveSource;
}

/**
 * What a caller signed with a pair it may not use here.
 *
 * ⛔ THE SAME ANSWER WHETHER OR NOT THE BUCKET EXISTS, which is why the restriction is checked
 *    before the resolver is asked. Answering `NoSuchBucket` for a name the caller may not touch
 *    would turn this gateway into a way of asking "does this business have a customer called…",
 *    one guess at a time.
 */
export const NOT_YOURS = "That access key may not use that bucket.";

/** Whether the pair that signed is allowed anywhere near this bucket name. */
export function mayTouch(credential: GatewayCredential, bucket: string): boolean {
  const only = credential.buckets;
  return only === undefined || only.includes(bucket);
}

export function headerOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw.join(",") : raw;
}

/** What the client said about the object it is writing, as the drive is handed it. */
export function metaOf(req: IncomingMessage): WriteMeta {
  const storageClass = headerOf(req, "x-amz-storage-class")?.trim().toUpperCase();
  return {
    storageClass: storageClass === undefined || storageClass === "" ? null : storageClass,
    contentType: headerOf(req, "content-type") ?? null,
  };
}

/** The one sentence a write gets from `nmts s3` when this machine has not agreed to spending. */
export function readOnlyOnThisMachine(): string {
  return (
    "This gateway is read only. Uploading spends credits, and this machine has not agreed to " +
    "spending — `nmts consent grant spend`, run by the person whose account this is, is what " +
    "changes that. Nothing was written."
  );
}

/** Why this drive takes no writes, in the words of whoever runs the gateway. */
export function readOnlyBecause(options: GatewayOptions): string {
  return options.readOnlyBecause ?? readOnlyOnThisMachine();
}

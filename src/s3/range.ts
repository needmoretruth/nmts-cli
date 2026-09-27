// The two questions a GET may ask before it wants bytes: which bytes, and only if what?
//
// ⛔ A RANGE IS ANSWERED OR IGNORED, NEVER GUESSED AT. One range in a form S3 knows is answered
//    206 with exactly those bytes; one that starts past the end is 416 with the size, so the client
//    can ask again; anything else — several ranges, a unit that is not bytes, a range written
//    backwards — is ignored and the whole object is answered 200, which is what HTTP says to do
//    and what S3 does. Every client already handles a 200 to a ranged request.
//
// ⚠ THE CONDITIONS ARE THE HTTP ONES, IN HTTP'S ORDER. `If-Match`, else `If-Unmodified-Since`;
//   then `If-None-Match`, else `If-Modified-Since`. Times compare at whole seconds, because that is
//   all an HTTP date carries.

import type { IncomingMessage } from "node:http";

import { headerOf } from "./call.ts";

export type RangeAsk =
  | { readonly kind: "whole" }
  | { readonly kind: "window"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

const WHOLE: RangeAsk = { kind: "whole" };

/** What a `Range` header asks of an object this many bytes long. */
export function rangeOf(header: string | undefined, size: number): RangeAsk {
  if (header === undefined) return WHOLE;
  const spec = /^\s*bytes\s*=\s*(.*)$/i.exec(header)?.[1];
  if (spec === undefined || spec.includes(",")) return WHOLE;
  const one = /^\s*(\d*)\s*-\s*(\d*)\s*$/.exec(spec);
  const first = one?.[1];
  const last = one?.[2];
  if (first === undefined || last === undefined || (first === "" && last === "")) return WHOLE;
  if (first === "") {
    // `bytes=-n`: the last n bytes, or all of them when there are fewer.
    const n = Number(last);
    if (n === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "window", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(first);
  // Written backwards it is not a range and is ignored; one that starts past the end is refused.
  if (last !== "" && Number(last) < start) return WHOLE;
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "window", start, end: last === "" ? size - 1 : Math.min(Number(last), size - 1) };
}

function bareTag(tag: string): string {
  return tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}

/** Whether a list of tags in a header names this one. `*` names every object that exists. */
function tagListHas(header: string, etag: string): boolean {
  const mine = bareTag(etag);
  return header.split(",").some((tag) => tag.trim() === "*" || bareTag(tag) === mine);
}

/** An HTTP date as whole seconds, or null when it is not one — and an unreadable date is ignored. */
function secondsOf(header: string): number | null {
  const ms = Date.parse(header);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** What the conditional headers of a GET or HEAD come to for this object. */
export function preconditionOf(req: IncomingMessage, etag: string, updatedAt: number): 200 | 304 | 412 {
  const changed = Math.floor(updatedAt / 1000);
  const ifMatch = headerOf(req, "if-match");
  const ifUnmodifiedSince = headerOf(req, "if-unmodified-since");
  if (ifMatch !== undefined) {
    if (!tagListHas(ifMatch, etag)) return 412;
  } else if (ifUnmodifiedSince !== undefined) {
    const at = secondsOf(ifUnmodifiedSince);
    if (at !== null && changed > at) return 412;
  }
  const ifNoneMatch = headerOf(req, "if-none-match");
  const ifModifiedSince = headerOf(req, "if-modified-since");
  if (ifNoneMatch !== undefined) {
    if (tagListHas(ifNoneMatch, etag)) return 304;
  } else if (ifModifiedSince !== undefined) {
    const at = secondsOf(ifModifiedSince);
    if (at !== null && changed <= at) return 304;
  }
  return 200;
}

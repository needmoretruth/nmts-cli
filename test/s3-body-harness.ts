// The bench the body decoder's tests share: one pair, one clock, one object's bytes, and a request
// with no socket behind it.
//
// ⚠ The request is an `IncomingMessage` with nothing behind it, fed by hand, so the body can be
//   split at any byte and cut off at any point. `s3-body-clients-*.test.ts` send real clients'
//   requests over a real socket.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { Readable } from "node:stream";

import { BodyRefusal, decodeBody } from "../src/s3/body.ts";
import type { ChecksumAlgorithm } from "../src/s3/checksum.ts";
import { verifyAgainst, type VerifiedAgainst } from "../src/s3/sigv4.ts";
import type { SignedFetch } from "./s3-sign.ts";

export const CREDENTIAL = {
  accessKeyId: "NMTSEXAMPLEKEYID0001",
  secretAccessKey: "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01",
};
export const HOST = "127.0.0.1:9000";
export const WHEN = new Date("2026-09-24T01:00:00Z");
export const NOW = WHEN.getTime() + 1_000;
export const DATA = Buffer.from("The quick brown fox jumps over the lazy dog.\n".repeat(300));

export type OkVerdict = Extract<VerifiedAgainst, { ok: true }>;

export interface Outcome {
  /** Null when the body was accepted. */
  readonly refusal: { readonly status: number; readonly code: string } | null;
  /** True when `decodeBody` refused before reading a byte. */
  readonly atOnce: boolean;
  readonly bytes: Buffer;
  readonly size: number | null;
}

function targetOf(signed: SignedFetch): string {
  return signed.url.slice(signed.url.indexOf("/", "http://".length));
}

export function verdictOf(signed: SignedFetch): OkVerdict {
  const verdict = verifyAgainst(
    { method: signed.method, url: targetOf(signed), headers: signed.headers },
    [CREDENTIAL],
    NOW,
  );
  if (!verdict.ok) assert.fail(`the signature itself was refused: ${verdict.code}: ${verdict.message}`);
  return verdict;
}

/** A request with no socket behind it, carrying `pieces` as its body; `cut` ends it abruptly. */
export function requestOf(headers: Readonly<Record<string, string>>, pieces: readonly Buffer[], cut = false): IncomingMessage {
  const socket = new Socket();
  socket.on("error", () => undefined);
  const req = new IncomingMessage(socket);
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;
  req.headers = lower;
  for (const piece of pieces) req.push(piece);
  if (cut) {
    setImmediate(() => req.destroy());
  } else {
    req.complete = true;
    req.push(null);
  }
  return req;
}

export function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => parts.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", reject);
  });
}

/** Split `bytes` into pieces of `every` bytes, so framing lines land across piece boundaries. */
export function split(bytes: Buffer, every: number): Buffer[] {
  const pieces: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += every) pieces.push(bytes.subarray(at, at + every));
  return pieces;
}

export async function run(req: IncomingMessage, verdict: OkVerdict): Promise<Outcome> {
  const decoded = decodeBody(req, verdict);
  if (decoded instanceof BodyRefusal) {
    return { refusal: { status: decoded.status, code: decoded.code }, atOnce: true, bytes: Buffer.alloc(0), size: null };
  }
  const bytes = collect(decoded.stream);
  try {
    await Promise.all([bytes, decoded.verified]);
    return { refusal: null, atOnce: false, bytes: await bytes, size: decoded.size };
  } catch (error) {
    if (!(error instanceof BodyRefusal)) throw error;
    return { refusal: { status: error.status, code: error.code }, atOnce: false, bytes: await bytes, size: decoded.size };
  }
}

/** Verify `signed`, then decode its body -- or `body` in its place -- delivered as `pieces`. */
export function decode(
  signed: SignedFetch,
  options: { body?: Buffer; every?: number; headers?: Record<string, string | undefined>; cut?: boolean } = {},
): Promise<Outcome> {
  const verdict = verdictOf(signed);
  const body = options.body ?? signed.body ?? Buffer.alloc(0);
  const headers: Record<string, string> = { ...signed.headers };
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === undefined) delete headers[name];
    else headers[name] = value;
  }
  const pieces = options.every === undefined ? [body] : split(body, options.every);
  return run(requestOf(headers, pieces, options.cut === true), verdict);
}

export function accepted(outcome: Outcome, expected: Buffer): void {
  assert.equal(outcome.refusal, null, `refused: ${JSON.stringify(outcome.refusal)}`);
  assert.equal(outcome.bytes.length, expected.length);
  assert.ok(outcome.bytes.equals(expected), "the decoded bytes are not the object's bytes");
}

export function refused(outcome: Outcome, status: number, code: string, atOnce?: boolean): void {
  assert.deepEqual(outcome.refusal, { status, code });
  if (atOnce !== undefined) assert.equal(outcome.atOnce, atOnce);
}

export const sha256hex = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export const ALGORITHMS: readonly ChecksumAlgorithm[] = ["crc32", "crc32c", "crc64nvme", "sha1", "sha256"];

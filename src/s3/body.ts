// The bytes of an upload as the object will hold them: whatever framing the client wrapped them in
// taken off, and every integrity promise the request made checked before anything is stored.
//
// ⛔ ONE PLACE FOR EVERY WAY A BODY CAN ARRIVE. A plain body with a hex digest, `UNSIGNED-PAYLOAD`,
//    a presigned URL, and the three `aws-chunked` forms (chunk-signed, chunk-signed with a trailer,
//    unsigned with a trailer) all end here and leave as the same shape. The protocol layer never
//    reads `content-encoding` or a trailer itself; a second reader would be a second place for the
//    framing to be stored as somebody's file. `body-plan.ts` (what the headers promise),
//    `body-deframe.ts` (the framing and its signatures) and `body-measure.ts` (digests and
//    checksums) are this module's parts, and nothing else imports them.
//
// ⛔ `verified` IS THE GATE, NOT A REPORT. The stream can be spooled while it arrives, but nothing
//    may be stored until `verified` resolves: a digest, a chunk signature or a checksum can only be
//    judged once the last byte is in.
//
// ⛔ THE STREAM NEVER FAILS; `verified` DOES. When the body turns out to be wrong halfway, `verified`
//    rejects first and the stream then simply ends, early. A caller that spools and awaits
//    `verified` alongside therefore always sees the refusal with its S3 status and code, instead of
//    a stream error it would have to translate -- or, worse, a short file and a success.

import type { IncomingMessage } from "node:http";
import { PassThrough, type Readable } from "node:stream";

import { Deframer } from "./body-deframe.ts";
import { Measure } from "./body-measure.ts";
import { BodyRefusal, incomplete, planOf } from "./body-plan.ts";
import type { ChecksumAlgorithm } from "./checksum.ts";
import type { VerifiedAgainst } from "./sigv4.ts";

export { BodyRefusal } from "./body-plan.ts";

/** A request body, decoded. */
export interface DecodedBody {
  /** The object's bytes, with any `aws-chunked` framing removed. */
  readonly stream: Readable;
  /**
   * How many bytes the object will have: `x-amz-decoded-content-length` for a framed body,
   * `content-length` otherwise. Null when the request declared neither.
   */
  readonly size: number | null;
  /**
   * Resolves once the whole body has been read and every rule the request carried held: the signed
   * payload digest, each chunk signature, the trailing or header checksum, `Content-MD5`.
   * Rejects with a `BodyRefusal` otherwise.
   */
  readonly verified: Promise<void>;
  /**
   * The `x-amz-checksum-*` values the body was held to, from its headers or its trailer, once
   * `verified` has resolved; empty before then. A piece of a multipart upload keeps them, so the
   * finish can be checked against them.
   */
  readonly checksums?: () => ReadonlyMap<ChecksumAlgorithm, Buffer>;
}

/** How one request's body is read. */
export interface DecodeOptions {
  /**
   * `x-amz-checksum-*` headers describe the OBJECT the request makes, not this body — true of
   * `CompleteMultipartUpload`, whose body is the part list. They are then left to the caller
   * rather than held against the body, which they would never match.
   */
  readonly checksumsDescribeObject?: boolean;
}

/**
 * Decode one request body, or say at once why it cannot be.
 *
 * ⚠ THE STREAM MUST BE READ. It is fed as the request arrives and pauses the request when nobody
 *   reads it, so a caller that awaits `verified` without consuming `stream` waits forever.
 */
export function decodeBody(
  req: IncomingMessage,
  verdict: Extract<VerifiedAgainst, { ok: true }>,
  options: DecodeOptions = {},
): DecodedBody | BodyRefusal {
  const plan = planOf(req, verdict, options.checksumsDescribeObject === true);
  if (plan instanceof BodyRefusal) return plan;
  const held = new Map<ChecksumAlgorithm, Buffer>();

  const out = new PassThrough();
  const measure = new Measure(plan);
  let settled = false;
  let accept: () => void = () => undefined;
  let reject: (refusal: BodyRefusal) => void = () => undefined;
  const verified = new Promise<void>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  // ⚠ Whoever awaits `verified` still sees the refusal; this only keeps an unawaited one -- a caller
  //   that gave up on the upload already -- from being reported as an unhandled rejection.
  verified.catch(() => undefined);

  const refuse = (refusal: BodyRefusal): void => {
    if (settled) return;
    settled = true;
    reject(refusal);
    if (!out.destroyed && !out.writableEnded) out.end();
    // The rest of the request is read and dropped, so the refusal can still be answered on this
    // connection rather than the client seeing it reset mid-upload.
    req.resume();
  };

  const emit = (bytes: Buffer): void => {
    measure.update(bytes);
    if (out.destroyed) return;
    if (!out.write(bytes)) req.pause();
  };
  out.on("drain", () => {
    if (!settled) req.resume();
  });
  out.on("close", () => {
    if (!settled) refuse(incomplete("the body's reader stopped before the end"));
  });

  const deframer = plan.framing === "plain" ? null : new Deframer(plan, emit);

  req.on("data", (chunk: Buffer) => {
    if (settled) return;
    if (deframer === null) {
      if (measure.count + chunk.length > plan.size) {
        refuse(incomplete("the body is longer than its declared length"));
        return;
      }
      emit(chunk);
      return;
    }
    const refused = deframer.feed(chunk);
    if (refused !== null) refuse(refused);
  });
  req.on("end", () => {
    if (settled) return;
    const refused = deframer?.finish() ?? null;
    const trailerValues = deframer?.trailerValues ?? new Map<ChecksumAlgorithm, Buffer>();
    const verdictOnBytes = refused ?? measure.judge(plan, trailerValues);
    if (verdictOnBytes !== null) {
      refuse(verdictOnBytes);
      return;
    }
    for (const [algorithm, value] of plan.headerChecksums) held.set(algorithm, value);
    for (const algorithm of plan.trailers) {
      const value = trailerValues.get(algorithm);
      if (value !== undefined) held.set(algorithm, value);
    }
    settled = true;
    accept();
    out.end();
  });
  req.on("error", () => refuse(incomplete("the connection closed before the body was complete")));
  req.on("close", () => {
    if (!settled) refuse(incomplete("the connection closed before the body was complete"));
  });

  return { stream: out, size: plan.size, verified, checksums: () => held };
}

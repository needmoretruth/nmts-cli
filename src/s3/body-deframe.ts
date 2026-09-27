// The `aws-chunked` framing taken off a body, with each chunk signature and the trailer checked on
// the way. One of the parts of `body.ts`; only it imports this.

import { createHash, createHmac, timingSafeEqual, type Hash } from "node:crypto";

import { BodyRefusal, incomplete, invalid, type Plan } from "./body-plan.ts";
import { algorithmOfHeader, checksumHeaderName, parseChecksumValue, type ChecksumAlgorithm } from "./checksum.ts";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** A chunk header or trailer line longer than this is not one a client wrote. */
const MAX_LINE_BYTES = 4096;
/** Nor is a trailer section longer than this: S3's trailers are a checksum and a signature. */
const MAX_TRAILER_BYTES = 16 * 1024;

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Takes `aws-chunked` framing off a body, checking each chunk signature and the trailer on the way.
 *
 * The format, per chunk: `<size in hex>[;chunk-signature=<64 hex>]\r\n<size bytes>\r\n`. A chunk of
 * size 0 ends the data; after it comes `\r\n` (chunk-signed), or trailer lines `name:value\r\n` --
 * followed, when chunk-signed, by `x-amz-trailer-signature:<64 hex>\r\n` -- and a last `\r\n`.
 *
 * ⚠ LENIENT IN EXACTLY ONE PLACE: the body may end without the final empty line once the last
 *   chunk and every promised trailer are in. The AWS SDK for JavaScript sends `0\r\n` and nothing
 *   more when it has no checksum to add; the bytes and their checks are complete by then, and a
 *   refusal would be over a line that carries nothing.
 */
export class Deframer {
  private state: "size" | "data" | "data-end" | "final-crlf" | "trailer" | "end" = "size";
  private line: Buffer[] = [];
  private lineBytes = 0;
  private trailerBytes = 0;
  private remaining = 0;
  private crlf = 0;
  private decoded = 0;
  private chunkHash: Hash | null = null;
  private chunkSignature = "";
  private previous: string;
  private trailerSignature: string | null = null;
  private readonly trailerPairs: Array<[string, string]> = [];
  readonly trailerValues = new Map<ChecksumAlgorithm, Buffer>();
  private readonly plan: Plan;
  private readonly signed: boolean;
  private readonly emit: (bytes: Buffer) => void;

  constructor(plan: Plan, emit: (bytes: Buffer) => void) {
    this.plan = plan;
    this.signed = plan.framing === "signed" || plan.framing === "signed-trailer";
    this.emit = emit;
    this.previous = plan.signing.seedSignature;
  }

  feed(chunk: Buffer): BodyRefusal | null {
    let at = 0;
    while (at < chunk.length) {
      switch (this.state) {
        case "size":
        case "trailer": {
          const newline = chunk.indexOf(0x0a, at);
          const end = newline < 0 ? chunk.length : newline;
          if (this.state === "trailer") {
            this.trailerBytes += end - at + (newline < 0 ? 0 : 1);
            if (this.trailerBytes > MAX_TRAILER_BYTES) return invalid("the trailer is longer than any client writes");
          }
          this.lineBytes += end - at;
          if (this.lineBytes > MAX_LINE_BYTES) return invalid("a chunk header or trailer line is longer than any client writes");
          if (end > at) this.line.push(chunk.subarray(at, end));
          if (newline < 0) return null;
          at = newline + 1;
          const text = this.takeLine();
          const refused =
            this.state === "size"
              ? this.onChunkHeader(text)
              : this.onTrailerLine(text.endsWith("\r") ? text.slice(0, -1) : text);
          if (refused !== null) return refused;
          break;
        }
        case "data": {
          const take = Math.min(this.remaining, chunk.length - at);
          const piece = chunk.subarray(at, at + take);
          at += take;
          this.remaining -= take;
          this.chunkHash?.update(piece);
          this.emit(piece);
          if (this.remaining === 0) {
            if (this.chunkHash !== null) {
              const refused = this.checkChunk(this.chunkHash.digest("hex"));
              this.chunkHash = null;
              if (refused !== null) return refused;
            }
            this.state = "data-end";
            this.crlf = 0;
          }
          break;
        }
        case "data-end":
        case "final-crlf": {
          const expected = this.crlf === 0 ? 0x0d : 0x0a;
          if (chunk[at] !== expected) {
            return invalid(
              this.state === "data-end"
                ? "a chunk's bytes are not followed by CRLF, so its size does not match its data"
                : "the last chunk is not followed by CRLF",
            );
          }
          at += 1;
          this.crlf += 1;
          if (this.crlf === 2) this.state = this.state === "data-end" ? "size" : "end";
          break;
        }
        case "end":
          return invalid("bytes follow the end of the aws-chunked body");
      }
    }
    return null;
  }

  /** The body has ended: was it whole? */
  finish(): BodyRefusal | null {
    switch (this.state) {
      case "size":
      case "data":
      case "data-end":
        return incomplete("the body ended before its last chunk");
      case "final-crlf":
      case "end":
        return null;
      case "trailer": {
        if (this.lineBytes > 0) {
          const text = this.takeLine();
          const line = text.endsWith("\r") ? text.slice(0, -1) : text;
          // The final empty line, cut short of its LF: closing the trailer is all it would do.
          if (line.length === 0) return this.onTrailerLine(line);
          const refused = this.onTrailerLine(line);
          if (refused !== null) return refused;
        }
        return this.closeTrailer();
      }
    }
  }

  private takeLine(): string {
    const text = Buffer.concat(this.line).toString("latin1");
    this.line = [];
    this.lineBytes = 0;
    return text;
  }

  private onChunkHeader(raw: string): BodyRefusal | null {
    if (!raw.endsWith("\r")) return invalid("a chunk header does not end in CRLF");
    const text = raw.slice(0, -1);
    const semicolon = text.indexOf(";");
    const sizeText = semicolon < 0 ? text : text.slice(0, semicolon);
    if (!/^[0-9a-fA-F]{1,13}$/.test(sizeText)) return invalid("a chunk does not start with its size in hex");
    const size = parseInt(sizeText, 16);
    if (this.signed) {
      const match = semicolon < 0 ? null : /^chunk-signature=([0-9a-f]{64})$/.exec(text.slice(semicolon + 1));
      const signature = match?.[1];
      if (signature === undefined) return invalid("a chunk of a chunk-signed body carries no chunk-signature");
      this.chunkSignature = signature;
    }
    if (this.decoded + size > this.plan.size) {
      return incomplete("the chunks carry more bytes than x-amz-decoded-content-length");
    }
    if (size === 0) {
      if (this.signed) {
        const refused = this.checkChunk(EMPTY_SHA256);
        if (refused !== null) return refused;
      }
      this.state = this.plan.framing === "signed" ? "final-crlf" : "trailer";
      this.crlf = 0;
      return null;
    }
    this.decoded += size;
    this.remaining = size;
    this.chunkHash = this.signed ? createHash("sha256") : null;
    this.state = "data";
    return null;
  }

  private hmac(stringToSign: string): string {
    return createHmac("sha256", this.plan.signing.key).update(stringToSign).digest("hex");
  }

  /** One link of the chain: this chunk's signature over its bytes and the signature before it. */
  private checkChunk(dataHash: string): BodyRefusal | null {
    const { stamp, scope } = this.plan.signing;
    const expected = this.hmac(
      ["AWS4-HMAC-SHA256-PAYLOAD", stamp, scope, this.previous, EMPTY_SHA256, dataHash].join("\n"),
    );
    if (!sameHex(expected, this.chunkSignature)) {
      return new BodyRefusal(403, "SignatureDoesNotMatch", "a chunk's signature does not match its bytes");
    }
    this.previous = expected;
    return null;
  }

  private onTrailerLine(line: string): BodyRefusal | null {
    if (line.length === 0) {
      this.state = "end";
      return this.closeTrailer();
    }
    if (this.trailerSignature !== null) return invalid("only the end of the body may follow the trailer signature");
    const colon = line.indexOf(":");
    if (colon < 0) return invalid("a trailer line is not name:value");
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "x-amz-trailer-signature") {
      if (this.plan.framing !== "signed-trailer") return invalid("an unsigned trailer carries a trailer signature");
      if (!/^[0-9a-f]{64}$/.test(value)) return invalid("the trailer signature is not 64 hex digits");
      this.trailerSignature = value;
      return null;
    }
    const algorithm = algorithmOfHeader(name);
    if (algorithm === null || !this.plan.trailers.includes(algorithm)) {
      return invalid(`the trailer ${name} was not declared in x-amz-trailer`);
    }
    if (this.trailerValues.has(algorithm)) return invalid(`the trailer ${name} arrives twice`);
    const parsed = parseChecksumValue(algorithm, value);
    if (parsed === null) return invalid(`the trailer ${name} is not a ${algorithm} value`);
    this.trailerValues.set(algorithm, parsed);
    this.trailerPairs.push([name, value]);
    return null;
  }

  /**
   * Every promised trailer is in; for a chunk-signed body, the trailer signature holds.
   *
   * The string it signs is `AWS4-HMAC-SHA256-TRAILER`, the timestamp, the scope, the last chunk's
   * signature, and the SHA-256 of the trailer headers as `name:value\n`, sorted by name.
   */
  private closeTrailer(): BodyRefusal | null {
    for (const algorithm of this.plan.trailers) {
      if (!this.trailerValues.has(algorithm)) {
        return invalid(`x-amz-trailer promised ${checksumHeaderName(algorithm)} and the body ended without it`);
      }
    }
    if (this.plan.framing !== "signed-trailer") return null;
    if (this.trailerSignature === null) return invalid("a chunk-signed trailer carries no x-amz-trailer-signature");
    const canonical = [...this.trailerPairs]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([name, value]) => `${name}:${value}\n`)
      .join("");
    const { stamp, scope } = this.plan.signing;
    const expected = this.hmac(
      [
        "AWS4-HMAC-SHA256-TRAILER",
        stamp,
        scope,
        this.previous,
        createHash("sha256").update(canonical).digest("hex"),
      ].join("\n"),
    );
    if (!sameHex(expected, this.trailerSignature)) {
      return new BodyRefusal(403, "SignatureDoesNotMatch", "the trailer signature does not match the trailer");
    }
    return null;
  }
}

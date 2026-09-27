import { BodyRefusal, type Plan } from "./body-plan.ts";
import { type ChecksumAlgorithm } from "./checksum.ts";
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
export declare class Deframer {
    private state;
    private line;
    private lineBytes;
    private trailerBytes;
    private remaining;
    private crlf;
    private decoded;
    private chunkHash;
    private chunkSignature;
    private previous;
    private trailerSignature;
    private readonly trailerPairs;
    readonly trailerValues: Map<ChecksumAlgorithm, Buffer<ArrayBufferLike>>;
    private readonly plan;
    private readonly signed;
    private readonly emit;
    constructor(plan: Plan, emit: (bytes: Buffer) => void);
    feed(chunk: Buffer): BodyRefusal | null;
    /** The body has ended: was it whole? */
    finish(): BodyRefusal | null;
    private takeLine;
    private onChunkHeader;
    private hmac;
    /** One link of the chain: this chunk's signature over its bytes and the signature before it. */
    private checkChunk;
    private onTrailerLine;
    /**
     * Every promised trailer is in; for a chunk-signed body, the trailer signature holds.
     *
     * The string it signs is `AWS4-HMAC-SHA256-TRAILER`, the timestamp, the scope, the last chunk's
     * signature, and the SHA-256 of the trailer headers as `name:value\n`, sorted by name.
     */
    private closeTrailer;
}

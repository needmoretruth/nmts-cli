import type { CryptoGlue } from "./crypto.ts";
import { type PartView } from "./download-part.ts";
import type { FetchedFile } from "./download.ts";
import type { PlaintextSink } from "./download-sink.ts";
import type { ReadOptions } from "./walrus.ts";
/** The bytes a sink keeps, when it keeps only some of the file and can be told what was left out. */
export declare function windowOf(sink: PlaintextSink): {
    start: number;
    end: number;
} | null;
/**
 * Deliver `window` of the file to `sink`, reading only the parts it falls in.
 *
 * ⛔ THE SINK IS COMMITTED IN ONE PLACE AND ABANDONED ON EVERY OTHER WAY OUT, as in `download.ts`.
 */
export declare function collectWindow(crypt: CryptoGlue, ordered: readonly PartView[], dek: Uint8Array, expected: Uint8Array | null, size: number, chain: string, read: ReadOptions | undefined, sink: PlaintextSink, window: {
    start: number;
    end: number;
}): Promise<FetchedFile>;

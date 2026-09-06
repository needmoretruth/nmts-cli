import type { CryptoGlue } from "./crypto.ts";
import { type ReadOptions } from "./walrus.ts";
export interface PartView {
    part_index: number;
    storage_kind: number;
    network?: number;
    blob_id: string;
    patch_id?: string;
}
export interface PartsResponse {
    size: number;
    parts: PartView[];
}
export declare function asParts(value: unknown): PartsResponse;
/**
 * Fetch one part's sealed bytes.
 *
 * ⛔ Refuse before reading, not after. A part on a storage network this build has no reader for
 *    would otherwise be fetched from a Walrus aggregator, 404, and be reported as missing bytes —
 *    which is a different thing and sends somebody looking for the wrong one.
 */
export declare function fetchPart(part: PartView, chain: string, read: ReadOptions | undefined): Promise<Uint8Array>;
/**
 * Open ONE part and pass its contribution on, a chunk at a time. Returns how much of the file it
 * contributed.
 *
 * ⛔ THE SEALED BYTES ARE FED IN ONE CHUNK AT A TIME, not all at once. Handing the engine the whole
 *    part would make it hand back the whole part's plaintext in one array, which is the ceiling
 *    this path exists to remove; feeding it a chunk's worth means at most one chunk of plaintext
 *    exists at a time. The size fed is the format's own chunk plus its tag, so a well-formed
 *    stream yields exactly one chunk per push — and a stream whose header declares a different
 *    chunk size still works, because the engine buffers what it has not finished.
 *
 * ⛔ `finish()` IS WHAT CATCHES A PART CUT SHORT. Every chunk that arrived authenticates; only the
 *    end-of-stream check knows the rest is missing. Skipping it would accept a truncated part.
 *
 * ⛔ THE ENGINE-SIDE SESSION IS FREED ON EVERY PATH OUT, including a failure: it holds the file
 *    key until it is, and a download that failed is exactly when nobody comes back to tidy up.
 */
export declare function openPart(crypt: CryptoGlue, dek: Uint8Array, part: PartView, sealed: Uint8Array, isLast: boolean, remaining: number, emit: (body: Uint8Array) => Promise<void>): Promise<number>;

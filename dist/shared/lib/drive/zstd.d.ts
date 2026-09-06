/**
 * What a platform must provide to write (and read) flag 0x02.
 *
 * `decompress` is given the largest plaintext the caller will accept. It exists so an encoder can
 * refuse a frame that CLAIMS to expand past that bound before it allocates for it — a sealed
 * document is authenticated, but a build that meets a corrupt or hostile one must still not be
 * asked for a gigabyte of memory first.
 */
export interface ZstdCodec {
    compress(bytes: Uint8Array, level: number): Uint8Array | Promise<Uint8Array>;
    decompress(bytes: Uint8Array, maxOut: number): Uint8Array | Promise<Uint8Array>;
}
/** The level a writer asks for. See the measurement in this file's header before changing it. */
export declare const ZSTD_LEVEL = 6;
/** Hand this build its zstd encoder, or `null` to take it away again (tests do the second). */
export declare function setZstdCodec(codec: ZstdCodec | null): void;
/** The registered encoder, or null when this build has none. */
export declare function zstdCodec(): ZstdCodec | null;
/**
 * The size the frame SAYS it expands to, or null when the frame does not declare one.
 *
 * Reads only the frame header described by RFC 8878, which is at most 14 bytes, so it costs
 * nothing and — this is the point — it runs BEFORE any buffer is allocated for the output. NCF-3
 * §6.3.4 requires our writers to emit the content size for exactly this reason; a frame without
 * one is not ours and is refused by the caller rather than guessed at.
 */
export declare function zstdContentSize(frame: Uint8Array): number | null;

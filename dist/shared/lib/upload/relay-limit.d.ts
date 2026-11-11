import { type SealingShape } from "../crypto/size-padding.ts";
/** Largest request body the Walrus upload relay accepts, in bytes (hardcoded in the relay). */
export declare const RELAY_BODY_LIMIT_BYTES: number;
/**
 * What NCF-3 adds to one part: a 72-byte header, and a 16-byte tag per 4 MiB chunk
 * (CRYPTO-FORMAT-NCF3.md §4.1). Each program's own sealing constants are tested equal to this.
 */
export declare const NCF3_PART_SHAPE: SealingShape;
/**
 * The billing unit the free padding floor fills up to (one credit's worth of bytes). Each
 * program's own `CREDIT_BYTES` is tested equal to this.
 */
export declare const PADDING_UNIT_BYTES: number;
/**
 * The largest relay body a part size can produce: a full part, or a final part padded by any rule.
 * Padding only ever grows with the length, so the full-size final part is the worst case.
 */
export declare function largestSealedPartBytes(partSizeBytes: number): number;
/** True when every part this size can produce goes through the relay. */
export declare function partFitsRelay(partSizeBytes: number): boolean;
/**
 * The largest whole-MiB part size that fits, derived from the two numbers above: 512 MiB, because
 * `pow2` pads anything larger to 1 GiB and 1 GiB plus its envelope is over the limit.
 */
export declare const MAX_PART_SIZE_BYTES: number;
/**
 * Throw before anything is priced or signed when a part size could produce a part the relay will
 * refuse. The message names both numbers so a caller sees what to choose instead.
 */
export declare function requirePartFitsRelay(partSizeBytes: number): void;

export type ChecksumAlgorithm = "crc32" | "crc32c" | "crc64nvme" | "sha1" | "sha256";
export declare const CHECKSUM_ALGORITHMS: readonly ChecksumAlgorithm[];
/** `crc32c` → `x-amz-checksum-crc32c`. */
export declare function checksumHeaderName(algorithm: ChecksumAlgorithm): string;
/** `x-amz-checksum-crc32c` → `crc32c`; anything else → null. Case does not matter. */
export declare function algorithmOfHeader(name: string): ChecksumAlgorithm | null;
/** `CRC32C` (as `x-amz-sdk-checksum-algorithm` spells it) → `crc32c`; anything else → null. */
export declare function algorithmOfName(name: string): ChecksumAlgorithm | null;
/**
 * The bytes a checksum header's value stands for, or null when it is not canonical base64 of the
 * right length for its algorithm.
 *
 * ⚠ `Buffer.from(…, "base64")` accepts almost anything and silently drops what it cannot read, so
 *   the shape is checked first: a value that decodes "leniently" to the right length is still not
 *   a value a client computed.
 */
export declare function parseChecksumValue(algorithm: ChecksumAlgorithm, value: string): Buffer | null;
/** A checksum being computed while bytes stream past. */
export interface RunningChecksum {
    update(bytes: Uint8Array): void;
    /** The finished value, big-endian for the CRCs, as S3 encodes it before base64. */
    digest(): Buffer;
}
export declare function runningChecksum(algorithm: ChecksumAlgorithm): RunningChecksum;
/** The whole value for some bytes, base64 as it travels in a header or a trailer. */
export declare function checksumOf(algorithm: ChecksumAlgorithm, bytes: Uint8Array): string;

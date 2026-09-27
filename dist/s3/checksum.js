// The object checksums an S3 client may attach to an upload, computed over the bytes as they pass.
//
// ⛔ THE FIVE S3 NAMES, AND NOTHING ELSE. `x-amz-checksum-crc32`, `-crc32c`, `-crc64nvme`, `-sha1`
//    and `-sha256` are the whole list S3 accepts; a name outside it is refused by the caller rather
//    than ignored, because an ignored checksum is a promise the client thinks was kept.
//
// ⚠ TWO OF THEM ARE TABLE-DRIVEN HERE BECAUSE NODE HAS NEITHER. CRC32 is `node:zlib`'s and the two
//   digests are `node:crypto`'s. CRC32C (Castagnoli) and CRC64NVME are plain table CRCs over their
//   published parameters; they check integrity, not authenticity, and nothing secret goes through
//   them. The tests hold both to the parameter sets' published check values and to values a real
//   AWS SDK computed.
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
export const CHECKSUM_ALGORITHMS = ["crc32", "crc32c", "crc64nvme", "sha1", "sha256"];
/** How many bytes each algorithm's value has once its base64 is decoded. */
const DIGEST_BYTES = {
    crc32: 4,
    crc32c: 4,
    crc64nvme: 8,
    sha1: 20,
    sha256: 32,
};
/** `crc32c` → `x-amz-checksum-crc32c`. */
export function checksumHeaderName(algorithm) {
    return `x-amz-checksum-${algorithm}`;
}
/** `x-amz-checksum-crc32c` → `crc32c`; anything else → null. Case does not matter. */
export function algorithmOfHeader(name) {
    const lower = name.toLowerCase();
    for (const algorithm of CHECKSUM_ALGORITHMS) {
        if (lower === checksumHeaderName(algorithm))
            return algorithm;
    }
    return null;
}
/** `CRC32C` (as `x-amz-sdk-checksum-algorithm` spells it) → `crc32c`; anything else → null. */
export function algorithmOfName(name) {
    const lower = name.trim().toLowerCase();
    for (const algorithm of CHECKSUM_ALGORITHMS) {
        if (lower === algorithm)
            return algorithm;
    }
    return null;
}
/**
 * The bytes a checksum header's value stands for, or null when it is not canonical base64 of the
 * right length for its algorithm.
 *
 * ⚠ `Buffer.from(…, "base64")` accepts almost anything and silently drops what it cannot read, so
 *   the shape is checked first: a value that decodes "leniently" to the right length is still not
 *   a value a client computed.
 */
export function parseChecksumValue(algorithm, value) {
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0)
        return null;
    const bytes = Buffer.from(trimmed, "base64");
    if (bytes.length !== DIGEST_BYTES[algorithm])
        return null;
    if (bytes.toString("base64") !== trimmed)
        return null;
    return bytes;
}
function table32(polynomial) {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? (c >>> 1) ^ polynomial : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
}
/** CRC-32C (Castagnoli): reflected, polynomial 0x82F63B78, init and final XOR all ones. */
const CRC32C_TABLE = table32(0x82f63b78);
/**
 * CRC-64/NVME: reflected, polynomial 0x9A6C9329AC4BC9B5 (0xAD93D23594C93659 unreflected), init and
 * final XOR all ones. Kept as two 32-bit halves so no BigInt is made per byte.
 */
const CRC64_POLY_HIGH = 0x9a6c9329;
const CRC64_POLY_LOW = 0xac4bc9b5;
const CRC64_TABLE_HIGH = new Uint32Array(256);
const CRC64_TABLE_LOW = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let high = 0;
    let low = n;
    for (let k = 0; k < 8; k++) {
        const carry = low & 1;
        low = ((low >>> 1) | ((high & 1) << 31)) >>> 0;
        high = high >>> 1;
        if (carry === 1) {
            high = (high ^ CRC64_POLY_HIGH) >>> 0;
            low = (low ^ CRC64_POLY_LOW) >>> 0;
        }
    }
    CRC64_TABLE_HIGH[n] = high;
    CRC64_TABLE_LOW[n] = low;
}
class Crc32 {
    value = 0;
    update(bytes) {
        this.value = crc32(bytes, this.value);
    }
    digest() {
        const out = Buffer.alloc(4);
        out.writeUInt32BE(this.value >>> 0);
        return out;
    }
}
class Crc32c {
    value = 0xffffffff;
    update(bytes) {
        let c = this.value;
        for (let i = 0; i < bytes.length; i++) {
            c = (CRC32C_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
        }
        this.value = c >>> 0;
    }
    digest() {
        const out = Buffer.alloc(4);
        out.writeUInt32BE((this.value ^ 0xffffffff) >>> 0);
        return out;
    }
}
class Crc64Nvme {
    high = 0xffffffff;
    low = 0xffffffff;
    update(bytes) {
        let high = this.high;
        let low = this.low;
        for (let i = 0; i < bytes.length; i++) {
            const index = (low ^ (bytes[i] ?? 0)) & 0xff;
            low = ((CRC64_TABLE_LOW[index] ?? 0) ^ ((low >>> 8) | (high << 24))) >>> 0;
            high = ((CRC64_TABLE_HIGH[index] ?? 0) ^ (high >>> 8)) >>> 0;
        }
        this.high = high;
        this.low = low;
    }
    digest() {
        const out = Buffer.alloc(8);
        out.writeUInt32BE((this.high ^ 0xffffffff) >>> 0, 0);
        out.writeUInt32BE((this.low ^ 0xffffffff) >>> 0, 4);
        return out;
    }
}
class Digest {
    hash;
    constructor(algorithm) {
        this.hash = createHash(algorithm);
    }
    update(bytes) {
        this.hash.update(bytes);
    }
    digest() {
        return this.hash.digest();
    }
}
export function runningChecksum(algorithm) {
    switch (algorithm) {
        case "crc32":
            return new Crc32();
        case "crc32c":
            return new Crc32c();
        case "crc64nvme":
            return new Crc64Nvme();
        case "sha1":
        case "sha256":
            return new Digest(algorithm);
    }
}
/** The whole value for some bytes, base64 as it travels in a header or a trailer. */
export function checksumOf(algorithm, bytes) {
    const running = runningChecksum(algorithm);
    running.update(bytes);
    return running.digest().toString("base64");
}

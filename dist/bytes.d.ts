/** These bytes as unpadded base64url. */
export declare function toBase64Url(bytes: Uint8Array): string;
/**
 * Base64url back to bytes.
 *
 * ⚠ PLAIN BASE64 IS ACCEPTED TOO, and on purpose: `Buffer.from(text, "base64url")` accepted both,
 *   and a record written by an older version of this tool has to keep opening.
 */
export declare function fromBase64Url(text: string): Uint8Array;
/** This text as UTF-8 bytes. */
export declare function utf8(text: string): Uint8Array;
/** These UTF-8 bytes as text. Malformed sequences become the replacement character. */
export declare function fromUtf8(bytes: Uint8Array): string;
/** One run of bytes from several, in order. */
export declare function concat(parts: readonly Uint8Array[]): Uint8Array;

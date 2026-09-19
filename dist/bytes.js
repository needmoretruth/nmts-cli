// Bytes to text and back, in the two spellings this format uses.
//
// ⛔ WHY NOT `Buffer`. It is Node's, it is the one global this package leaned on that a browser
//    does not have, and every use of it was one of these five calls. A bundler shim would drag a
//    polyfill of the whole class into a page to reach `toString("base64url")`; these are ten lines
//    on top of what the chain library already carries.
//
// ⛔ BASE64URL IS THE FORMAT'S SPELLING (NCF-3), not a preference. Sealed blobs, wrapped keys and
//    chunk names all travel unpadded with `-` and `_`, because they end up in URLs and file names.
//    The alphabet swap and the padding live here, in one place, so that a second spelling cannot
//    appear somewhere and produce a name that never matches.
//
// ⛔ `atob`/`btoa` RATHER THAN A LIBRARY, and that is not a reinvention: they are the runtime's own
//    base64, present in Node and in every browser, and they are what the browser half of this
//    product already decodes with (`web/src/lib/crypto/wasm-engine.ts`). A package would be a
//    dependency in the chain of `nmts --help`, which `check:cli-startup` measures and refuses.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** These bytes as unpadded base64url. */
export function toBase64Url(bytes) {
    let binary = "";
    // ⚠ In runs rather than one `String.fromCharCode(...bytes)`: spreading a multi-megabyte array
    //   into an argument list overflows the stack, and the sealed blobs here are exactly that big.
    for (let at = 0; at < bytes.length; at += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(at, Math.min(at + 0x8000, bytes.length)));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * Base64url back to bytes.
 *
 * ⚠ PLAIN BASE64 IS ACCEPTED TOO, and on purpose: `Buffer.from(text, "base64url")` accepted both,
 *   and a record written by an older version of this tool has to keep opening.
 */
export function fromBase64Url(text) {
    const standard = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(standard.padEnd(standard.length + ((4 - (standard.length % 4)) % 4), "="));
    const out = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1)
        out[at] = binary.charCodeAt(at);
    return out;
}
/** This text as UTF-8 bytes. */
export function utf8(text) {
    return encoder.encode(text);
}
/** These UTF-8 bytes as text. Malformed sequences become the replacement character. */
export function fromUtf8(bytes) {
    return decoder.decode(bytes);
}
/** One run of bytes from several, in order. */
export function concat(parts) {
    let total = 0;
    for (const part of parts)
        total += part.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

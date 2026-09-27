// The public link's text shapes (NCF-3 §5.8).
//
// A public link is `<origin>/l/<token>#<secret>`: the token names the server's row, the secret `S`
// opens the file key the row holds, and the part after `#` never reaches a server. This module
// builds and reads that text, and the small document sealed beside the link that tells the reader
// the file's real length (and, when the owner chose to show it, its name).
//
// ⛔ THE DOCUMENT IS THE §5.4 SHARE DOCUMENT, not a new format. A link that shows the name seals the
//    same bytes a private share does (`shared-file-info.ts`); one that hides it leaves the `name`
//    key out and keeps `size`, because the size is what takes size padding back off.
//
// ⚠ IT IS COPIED VERBATIM INTO THE CLI (`deploy/gen-cli-shared.mjs`), so it depends on nothing and
//   both programs read and write the same link.
/** The path segment every public link lives under. */
export const LINK_PATH = "/l/";
/** Same marker as `shared-file-info.ts` — the document is that document. */
const SHARE_FILE_FORMAT = "nmts-share-file/1";
/** 16 bytes, unpadded base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
/**
 * 32 bytes, unpadded CANONICAL base64url: 43 characters, and the last one carries only the four
 * bits that are left, so its two low bits are zero. A second spelling of the same bytes is refused
 * rather than silently accepted (§5.8 step 1).
 */
const SECRET_RE = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
/** Is this a link token (16 bytes, base64url)? */
export function isLinkToken(value) {
    return TOKEN_RE.test(value);
}
/** Is this a link secret (32 bytes, canonical unpadded base64url)? */
export function isLinkSecret(value) {
    return SECRET_RE.test(value);
}
/** The whole link. `origin` is scheme + host (no trailing slash), e.g. `https://nmts.me`. */
export function buildPublicLink(origin, token, secret) {
    return `${origin.replace(/\/+$/, "")}${LINK_PATH}${token}#${secret}`;
}
/**
 * Read a link: a whole URL, or anything that ends in `/l/<token>#<secret>` (a locale prefix such as
 * `/ko` is allowed before it). `null` when either half is missing or not the right shape.
 */
export function parsePublicLink(text) {
    const trimmed = text.trim();
    const hash = trimmed.indexOf("#");
    if (hash < 0)
        return null;
    const secret = trimmed.slice(hash + 1);
    const before = trimmed.slice(0, hash).replace(/[?].*$/, "").replace(/\/+$/, "");
    const at = before.lastIndexOf(LINK_PATH);
    if (at < 0)
        return null;
    const token = before.slice(at + LINK_PATH.length);
    if (!isLinkToken(token) || !isLinkSecret(secret))
        return null;
    return { token, secret };
}
/** The string to seal as the link's `name` envelope. */
export function encodeLinkDocument(doc) {
    // Key order matches `encodeSharedFileInfo`, so a link that shows the name seals the same bytes.
    return doc.name === null
        ? JSON.stringify({ f: SHARE_FILE_FORMAT, size: doc.size })
        : JSON.stringify({ f: SHARE_FILE_FORMAT, name: doc.name, size: doc.size });
}
/**
 * Read an opened `name` envelope. `null` when it is not the document or has no usable size — a
 * link's reader cannot take padding off without the size, so that is a damaged link (§5.8 step 4).
 */
export function decodeLinkDocument(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return null;
    const f = Reflect.get(parsed, "f");
    const name = Reflect.get(parsed, "name");
    const size = Reflect.get(parsed, "size");
    if (f !== SHARE_FILE_FORMAT)
        return null;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        return null;
    if (name !== undefined && typeof name !== "string")
        return null;
    return { name: typeof name === "string" ? name : null, size };
}
/** The expiry choices the share sheet and the CLI offer, in days. `null` = never. */
export const LINK_EXPIRY_PRESETS = [null, 7, 30];
/** The longest expiry a person may type, in days (ten years). */
export const LINK_EXPIRY_MAX_DAYS = 3650;
/** A typed number of days, or null when it is not a whole number in 1..LINK_EXPIRY_MAX_DAYS. */
export function linkExpiryDays(value) {
    const n = typeof value === "number" ? value : Number(value.trim());
    return Number.isSafeInteger(n) && n >= 1 && n <= LINK_EXPIRY_MAX_DAYS ? n : null;
}
/** `expires_at` for a link that lasts `days` from `now`, or undefined for one that never ends. */
export function linkExpiresAt(days, now) {
    if (days === null)
        return undefined;
    return new Date(now.getTime() + days * 86_400_000).toISOString();
}
/** The name a saved link file gets. */
export function linkFileName(token) {
    return `nmts-link-${token}.txt`;
}

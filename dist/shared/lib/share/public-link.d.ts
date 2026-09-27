/** The path segment every public link lives under. */
export declare const LINK_PATH = "/l/";
/** The two halves of a link. Neither is checked against a server here. */
export interface PublicLinkParts {
    token: string;
    secret: string;
}
/** Is this a link token (16 bytes, base64url)? */
export declare function isLinkToken(value: string): boolean;
/** Is this a link secret (32 bytes, canonical unpadded base64url)? */
export declare function isLinkSecret(value: string): boolean;
/** The whole link. `origin` is scheme + host (no trailing slash), e.g. `https://nmts.me`. */
export declare function buildPublicLink(origin: string, token: string, secret: string): string;
/**
 * Read a link: a whole URL, or anything that ends in `/l/<token>#<secret>` (a locale prefix such as
 * `/ko` is allowed before it). `null` when either half is missing or not the right shape.
 */
export declare function parsePublicLink(text: string): PublicLinkParts | null;
/** What a link's sealed document says. `name` is null when the owner hid it. */
export interface LinkDocument {
    name: string | null;
    /** The file's real plaintext length. */
    size: number;
}
/** The string to seal as the link's `name` envelope. */
export declare function encodeLinkDocument(doc: LinkDocument): string;
/**
 * Read an opened `name` envelope. `null` when it is not the document or has no usable size — a
 * link's reader cannot take padding off without the size, so that is a damaged link (§5.8 step 4).
 */
export declare function decodeLinkDocument(text: string): LinkDocument | null;
/** The expiry choices the share sheet and the CLI offer, in days. `null` = never. */
export declare const LINK_EXPIRY_PRESETS: readonly (number | null)[];
/** The longest expiry a person may type, in days (ten years). */
export declare const LINK_EXPIRY_MAX_DAYS = 3650;
/** A typed number of days, or null when it is not a whole number in 1..LINK_EXPIRY_MAX_DAYS. */
export declare function linkExpiryDays(value: string | number): number | null;
/** `expires_at` for a link that lasts `days` from `now`, or undefined for one that never ends. */
export declare function linkExpiresAt(days: number | null, now: Date): string | undefined;
/** The name a saved link file gets. */
export declare function linkFileName(token: string): string;

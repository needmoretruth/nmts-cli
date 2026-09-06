/** What a recipient learns about a shared file before fetching a byte of it. */
export interface SharedFileInfo {
    /** Plaintext file name, exactly as the sender's drive spells it. */
    name: string;
    /**
     * The file's REAL plaintext length. Absent for a share sealed before this document existed.
     *
     * Absent must be read as "not recorded", never as "zero" and never as "unpadded": what makes an
     * older share safe is the content hash, not this field.
     */
    size?: number;
}
/** The string to seal as `name_share_ct`. */
export declare function encodeSharedFileInfo(info: SharedFileInfo): string;
/**
 * Read what the sender sealed. Never throws: a name that cannot be parsed IS the name.
 *
 * The refusal to throw is deliberate. This runs while painting a list of everything shared with a
 * person, and one row whose document is malformed must not take the other rows' names down with it.
 */
export declare function decodeSharedFileInfo(sealed: string): SharedFileInfo;

/** S3's own ceiling on a key, in UTF-8 bytes. */
export declare const MAX_KEY_BYTES = 1024;
/** The form two keys are compared in: the drive's own folding of names. */
export declare function sameKey(key: string): string;
/**
 * Refuse a key this drive cannot hold as the path it names. A key ending in `/` is a folder marker
 * and is judged as the folder it names.
 *
 * ⛔ EVERY CHECK IS ON THE KEY ALONE, so this runs before the body is read and before any list is.
 */
export declare function checkKey(key: string): void;

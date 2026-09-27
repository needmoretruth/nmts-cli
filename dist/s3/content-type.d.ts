export declare const UNKNOWN_TYPE = "application/octet-stream";
/** `photos/a.JPG` → `image/jpeg`. The extension is what follows the last dot of the last segment. */
export declare function contentTypeOf(key: string): string;

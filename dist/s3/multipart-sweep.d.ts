/** An upload's directory: `nmts-mpu-` and the upload id. */
export declare const UPLOAD_DIR: RegExp;
/** A single upload's body, spooled before it is stored: `nmts-put-` and a random id. */
export declare const SPOOL_FILE: RegExp;
/** The directory an upload's pieces live in. */
export declare function uploadDirName(uploadId: string): string;
/** A fresh name for one upload's spooled body. */
export declare function spoolFileName(): string;
/** Mark a directory as in use now, so no process's sweep takes it for abandoned. */
export declare function touch(path: string, now: number): Promise<void>;
/**
 * Remove every upload directory and spooled body under `root` that this gateway's names made, that
 * `inUse` does not claim, and that has not changed for `lifetimeMs`.
 */
export declare function sweepRoot(root: string, now: number, lifetimeMs: number, inUse: (uploadId: string) => boolean): Promise<void>;

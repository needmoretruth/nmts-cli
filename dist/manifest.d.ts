import { type Manifest } from "./shared/lib/drive/manifest-codec.ts";
/** This machine's copy of one account's sealed file list. */
export interface KeptList {
    /** The version these bytes carry. Higher is newer — the same counter every device syncs by. */
    seq: number;
    /** When THIS MACHINE wrote the copy, RFC3339 on its own clock. */
    savedAt: string;
    /** The sealed blob, base64url: exactly the bytes the server served or this tool wrote. */
    ct: string;
}
/**
 * The copy this machine holds for an account, or null when it holds none.
 *
 * ⚠ A COPY THAT CANNOT BE READ IS REPORTED AS NO COPY, on purpose. There is nothing to salvage
 *   from a truncated one, the next read of the list replaces it, and a command that refused to
 *   write out a good copy because an old one is unreadable would be refusing the very thing it is
 *   for.
 */
export declare function readKeptList(accountId: string): KeptList | null;
/**
 * Record a version this machine WROTE, so the server cannot serve an older one back afterwards.
 *
 * ⛔ ONLY AFTER THE SERVER ACCEPTED IT. Recording a version that lost the compare-and-swap would
 *    leave this machine believing in a list that never existed — and then refusing the real one as
 *    a rollback.
 */
export declare function recordWrittenList(accountId: string, seq: number, ct: string): Promise<void>;
/** True when this machine has a record for the account — i.e. a rollback would be visible. */
export declare function hasSeenBefore(accountId: string): boolean;
export interface FileList {
    /** null when the account has no list yet — a new account, not an error. */
    manifest: Manifest | null;
    /**
     * base64url SHA-256 of the sealed blob this list came out of. Absent with no list.
     *
     * ⛔ A WRITER NEEDS IT. The next version has to name the blob it continued from, or the fork
     *    check has a hole exactly where a fork would be introduced.
     */
    fingerprint?: string;
    /** The version the sealed blob itself claims. Absent with no list. */
    seq?: number;
    /** What the server's column said, when it disagreed with the sealed value. */
    serverSeqDisagreed?: number;
    /** True when nothing on this machine could have caught a rollback. */
    firstTimeOnThisMachine: boolean;
}
/**
 * Fetch and open the account's file list.
 *
 * `accountCode` is used here and not kept: the file-list key is derived, used, and zeroed. The
 * derivation output holds every other key in the account, so it does not outlive this call.
 */
export declare function readFileList(base: string, apiKey: string, accountCode: string, accountId: string): Promise<FileList>;

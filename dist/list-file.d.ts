import { WRITTEN_BY, type ArtifactAbout } from "./artifact-about.ts";
/** Wrapper format identifier, distinct from the recovery list's. */
export declare const LIST_FILE_FORMAT = "nmts-file-list";
/** The shell's version. Not the file list's own version, which is `seq`. */
export declare const LIST_FILE_VERSION = 1;
/** Filename extension. Deliberately not the recovery list's: the two must not be confusable. */
export declare const LIST_FILE_EXTENSION = "nmtslist";
export { WRITTEN_BY };
/** The on-disk document. */
export interface FileListFile {
    format: typeof LIST_FILE_FORMAT;
    version: typeof LIST_FILE_VERSION;
    /** The list's own version number — higher is newer, the counter every device syncs by. */
    seq: number;
    /** RFC3339 — when the machine wrote its copy, on its own clock. Absent when it is not known. */
    saved_at?: string;
    /** Public account id, so a person holding several files knows which is which. */
    account_id: string;
    /** The sealed file list, base64url. Unreadable without the account code. */
    sealed: string;
    /** Plain-language lines for a finder. */
    note: string[];
    about: ArtifactAbout;
}
export interface BuildListFileInput {
    accountId: string;
    seq: number;
    /** When the copy was taken, RFC3339. Omitted when the copy does not record one. */
    savedAt?: string | undefined;
    sealed: string;
}
/**
 * Build the document and the name to offer it under.
 *
 * Pure on purpose: it touches no disk and no clock, so what it produces can be compared against
 * the format itself rather than against whatever the machine running it happened to be doing.
 *
 * ⚠ THE VERSION IS IN THE FILENAME, ZERO-PADDED, so a folder holding several copies sorts into
 *   the order they were written and the newest is the last one.
 */
export declare function buildFileListFile(input: BuildListFileInput): {
    filename: string;
    content: string;
};

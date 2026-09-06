import { WRITTEN_BY, type ArtifactAbout } from "./artifact-about.ts";
/** Wrapper format identifier, distinct from the recovery list's. */
export declare const LIST_FILE_FORMAT = "nmts-file-list";
/**
 * The shell's version for a file holding ONE sealed blob. Not the file list's own version (`seq`).
 *
 * ⛔ A shell of version 1 means `sealed` is the whole list, and that has not changed. It is what an
 *    account still on the single-blob format produces, and every reader that ever handled this file
 *    goes on handling it.
 */
export declare const LIST_FILE_VERSION = 1;
/**
 * The shell's version for a file holding an INDEX and the chunks it names (NCF-3 §6.3).
 *
 * ⛔ WHY THE SHELL HAD TO MOVE TOO. At format version 2 the sealed blob the server stores is an
 *    index: it carries the settings, the version and the parent link, and NOT the entries. A copy
 *    of that blob alone is a copy of nothing anybody can use, so the chunks travel in the same
 *    file — one artefact, as before, because the whole point of this file is that the person
 *    holding it has everything.
 */
export declare const LIST_FILE_VERSION_CHUNKED = 2;
/** Filename extension. Deliberately not the recovery list's: the two must not be confusable. */
export declare const LIST_FILE_EXTENSION = "nmtslist";
export { WRITTEN_BY };
/** The on-disk document. */
export interface FileListFile {
    format: typeof LIST_FILE_FORMAT;
    version: typeof LIST_FILE_VERSION | typeof LIST_FILE_VERSION_CHUNKED;
    /** The list's own version number — higher is newer, the counter every device syncs by. */
    seq: number;
    /** RFC3339 — when the machine wrote its copy, on its own clock. Absent when it is not known. */
    saved_at?: string;
    /** Public account id, so a person holding several files knows which is which. */
    account_id: string;
    /** The sealed file list, base64url. At shell version 2 this is the INDEX. */
    sealed: string;
    /**
     * The sealed chunks the index names, base64url, in the order it names them. Shell version 2 only.
     *
     * ⛔ IN THE INDEX'S OWN ORDER, and a reader must keep it. The index names each chunk by the hash
     *    of its transport string, so a reader can pair them up by hashing — but it should not have
     *    to, and a copy that arrived shuffled would be a copy nobody could check quickly.
     */
    chunks?: string[];
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
    /** The chunks the sealed index names. Absent or empty for a single-blob list. */
    chunks?: readonly string[] | undefined;
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
/** What a `.nmtslist` turned out to hold, whichever shell version wrote it. */
export interface ReadListFile {
    /** The list's own version number. */
    seq: number;
    accountId: string;
    /** The sealed blob: the whole list at shell version 1, the index at shell version 2. */
    sealed: string;
    /** The sealed chunks the index names, in its order. Empty for a single-blob file. */
    chunks: string[];
}
/**
 * Read one of these files back, accepting BOTH shells.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSING. A file missing its sealed bytes, or naming chunks that are
 *    not strings, is not a shorter list — it is a copy somebody has been keeping for years that
 *    turns out not to be one, and the moment to say so is the moment they reach for it.
 */
export declare function parseFileListFile(text: string): ReadListFile;

import { type ArtifactAbout } from "./artifact-about.ts";
/** Wrapper format identifier, checked on read before anything is attempted. */
export declare const MAP_FILE_FORMAT = "nmts-recovery-map";
/**
 * Wrapper version — the SHELL's version, independent of the NRM version inside.
 *
 * ⛔ NOT RAISED FOR ANYTHING THIS TOOL ADDS. `MAX_WRAPPER_VERSION` in the standalone program is a
 *    CEILING: a shell numbered higher than a build knows is refused outright, unread. So a bump is
 *    a wall in front of every reader already in somebody's hands, never a courtesy.
 */
export declare const MAP_FILE_VERSION = 2;
/** Filename extension. Deliberately not the file-list copy's: the two must not be confusable. */
export declare const MAP_FILE_EXTENSION = "nmtsmap";
/** The version to stamp for a document declaring `nrm`. */
export declare function minimumToolVersion(nrm: number): string;
/** The on-disk document. */
export interface RecoveryMapFile {
    format: typeof MAP_FILE_FORMAT;
    version: typeof MAP_FILE_VERSION;
    /** NRM version of the sealed document. Read it before parsing what is inside. */
    nrm: number;
    /** Which list this is. Higher wins during a recovery. Version-independent. */
    seq: number;
    /** RFC3339 capture time, copied from inside the sealed document. */
    generated_at: string;
    /** Public account id, so a person holding several files knows which is which. */
    account_id: string;
    /** The sealed list: base64url of one NCF-3 envelope under `nmts/v3/recovery-map`. */
    sealed: string;
    min_tool: string;
    note: string[];
    about: ArtifactAbout;
}
export interface BuildMapFileInput {
    accountId: string;
    seq: number;
    generatedAt: string;
    /**
     * NRM version of the document actually sealed.
     *
     * ⛔ NOT A CONSTANT. From NRM-3 on the number a document declares depends on what is IN it, so a
     *    wrapper stating the newest version this build knows would mislabel every ordinary file —
     *    and a recovery program refuses a document claiming a version it does not know without
     *    reading a byte of it.
     */
    nrm: number;
    sealed: string;
}
/** Build the on-disk document and the filename to offer it under. */
export declare function buildRecoveryMapFile(input: BuildMapFileInput): {
    filename: string;
    content: string;
};

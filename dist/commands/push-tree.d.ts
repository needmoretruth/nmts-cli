import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
/** One local file, and where it goes in the drive. */
export interface PlannedFile {
    /** Absolute path on this machine. */
    local: string;
    /** Folder path inside the drive. */
    folder: string;
    name: string;
    size: number;
}
/** The directory as typed: refused when it is missing or a file, then walked. */
export declare function localTree(target: string, to: string | undefined, hidden: boolean): {
    root: string;
    found: PlannedFile[];
};
/** Which found files the drive already holds, which to send, and the folders already known. */
export declare function splitAlready(entries: readonly ManifestEntry[], found: readonly PlannedFile[]): {
    folderIds: Map<string, string | null>;
    already: PlannedFile[];
    todo: PlannedFile[];
};
export { walk as filesUnderDirectory };
/** Every file under a local directory, with the drive folder each one belongs in. */
declare function walk(dir: string, driveFolder: string, hidden: boolean): PlannedFile[];

import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
export interface TrashOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function rm(paths: readonly string[], options?: TrashOptions): Promise<number>;
export declare function restore(paths: readonly string[], options?: TrashOptions): Promise<number>;
/**
 * Every file at or under one entry.
 *
 * ⚠ Trashed descendants are INCLUDED HERE, and the CALLER filters. Somebody who trashed one file
 *   last week and then trashes its folder expects the folder to be gone from the server too — so
 *   `rm` takes this set whole. `restore` cannot: see the note at the call site.
 */
export declare function filesUnder(entries: readonly ManifestEntry[], rootId: string): ManifestEntry[];

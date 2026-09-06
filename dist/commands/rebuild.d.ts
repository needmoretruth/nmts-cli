import type { PairVerdict } from "../shared/lib/drive/rebuild-verify.ts";
import type { SourceItem } from "../rebuild.ts";
export interface RebuildOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** Write the rebuilt list. Without this the run reports and writes nothing. */
    yes?: boolean;
    /** Rebuild even though this machine has seen a file list for this account before. */
    force?: boolean;
    write?: (line: string) => void;
    /**
     * The key check, injected. Absent = the real one, which reads 72 bytes of each file's first
     * stored part from the storage network (`rebuild-key-check.ts`).
     */
    verify?: (item: SourceItem) => Promise<PairVerdict>;
}
export declare function rebuild(options?: RebuildOptions): Promise<number>;

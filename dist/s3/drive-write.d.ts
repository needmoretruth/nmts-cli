import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { DriveWriter } from "./contract.ts";
import type { DriveAccount } from "./drive.ts";
import { type WriteCondition } from "./drive-conditions.ts";
import type { KeyLocks } from "./drive-lock.ts";
import { type DriveObject } from "./listing.ts";
import type { StagingStore } from "./staging.ts";
/** Everything the writer needs from the drive it writes. */
export interface WriterSetup {
    readonly account: DriveAccount;
    /** The drive's list: cached, or `fresh` past the cache. */
    readonly entries: (asked?: {
        readonly fresh?: boolean;
    }) => Promise<readonly ManifestEntry[]>;
    /** Drop the cached list, after a write. */
    readonly forget: () => void;
    readonly stagingRoot: string;
    readonly staging: StagingStore;
    readonly bucket: string;
    readonly owner: () => Promise<string | null>;
    readonly locks: KeyLocks;
    readonly overwrite: "replace" | "refuse";
    readonly maxObjectBytes: number | undefined;
    readonly onAlreadyStored: ((key: string) => void) | undefined;
}
/** `photos/2026/a.jpg` → the folder to make and the name to store under. */
export declare function placeOf(key: string): {
    folder: string | undefined;
    name: string;
};
/**
 * Refuse, on the list as it is cached, a write whose answer is already known: a folder in the way,
 * or a condition that does not hold. The protocol layer asks this before reading a body, so a
 * refusal it can know keeps its own status and costs nobody an upload; the writer asks again,
 * inside the key's lock, and that answer is the one that decides.
 */
export declare function precheck(objects: readonly DriveObject[], key: string, condition: WriteCondition): void;
export declare function createWriter(setup: WriterSetup): DriveWriter;

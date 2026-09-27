import { type ListEditInput } from "../manifest-write.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ManifestIntent } from "../shared/lib/drive/manifest-ops.ts";
/** The entries in the trash that hold this name in this folder, compared as the drive compares names. */
export declare function trashedHolders(entries: readonly ManifestEntry[], folder: string | undefined, name: string): ManifestEntry[];
/** The renames that free the name: each trashed holder to the first numbered name nothing holds. */
export declare function freeingIntents(entries: readonly ManifestEntry[], folder: string | undefined, name: string, now: number): ManifestIntent[];
/**
 * Rename whatever in the trash holds `name` in `folder`, in one write to the file list.
 *
 * ⛔ DECIDED AGAIN ON EVERY ATTEMPT, from the list that attempt read, as every edit of the list is.
 */
export declare function freeTrashedName(input: ListEditInput, folder: string | undefined, name: string): Promise<void>;

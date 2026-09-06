import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
export interface CreateListInput {
    server: string;
    apiKey: string;
    /** The NMTS key. Used to derive the file-list key, and not kept. */
    code: string;
    accountId: string;
}
export interface CreateListResult {
    /** The version the server says is now current. 1 for a list that had nothing before it. */
    seq: number;
}
/**
 * Seal these entries as store version 1 and write them, or refuse because a list already exists.
 *
 * ⛔ NO `prev` LINK, because there is nothing before this. The first version is the one version
 *    that is allowed not to name what it continued from; every version after it must, or the fork
 *    check has a hole exactly where a fork would be introduced.
 *
 * ⛔ NO SETTINGS EITHER. Account settings live in this blob or nowhere, and a rebuild has none to
 *    carry: they were in the list that was lost. Writing an empty set is not a loss caused here.
 */
export declare function createFirstList(input: CreateListInput, entries: readonly ManifestEntry[]): Promise<CreateListResult>;

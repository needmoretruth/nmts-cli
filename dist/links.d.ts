import type { PlaintextSink } from "./download-sink.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
import type { ReadOptions } from "./walrus.ts";
/** The account a link is made or listed for — the same four things every account call takes. */
export interface LinkAccount {
    readonly server: string;
    /** API key or delegation token. */
    readonly bearer: string;
    /** The NMTS key, display form. Its dataKey opens the file key and seals the owner's copy of `S`. */
    readonly code: string;
}
export interface MadeLink {
    /** The whole link, secret included. */
    link: string;
    id: string;
    createdAt: string;
    expiresAt: string | null;
}
export interface ListedLink {
    id: string;
    /** The server's id for the file the link opens. */
    itemId: string;
    /** The whole link again, or null when it is cut (or its sealed secret did not open). */
    link: string | null;
    showsName: boolean;
    createdAt: string;
    expiresAt: string | null;
    /** When it was cut, and by whom: `owner` · `operator` · `report`. */
    cutAt: string | null;
    cutBy: string | null;
    downloads: number;
}
/** Make a link to one file of the account's list. */
export declare function makeLink(account: LinkAccount, entry: ManifestEntry, options: {
    showName: boolean;
    expiresDays: number | null;
    now?: Date;
}): Promise<MadeLink>;
/** Every link the account made to one file, newest first, cut ones included. */
export declare function listLinks(account: LinkAccount, itemId: string): Promise<ListedLink[]>;
/**
 * Every LIVE link the account holds, across all its files, newest first. Each names its file by
 * `itemId`; the file's name is in the account's own sealed list, which the server cannot read.
 */
export declare function listLiveLinks(account: LinkAccount): Promise<ListedLink[]>;
/** Cut every live link the account holds, in one request: all or none. Returns how many were cut. */
export declare function revokeAllLinks(account: LinkAccount): Promise<number>;
/** Cut one of the account's links. Cutting one that is already cut is not an error. */
export declare function revokeLink(account: LinkAccount, id: string): Promise<void>;
export interface OpenedLinkFile {
    /** The file's name, or null when the owner hid it. */
    name: string | null;
    bytes: number;
    parts: number;
}
/**
 * Open a link and deliver its file to `sink`, checked against the owner's digest. No account.
 *
 * `name` is told the file's name (or null) before a byte is fetched, so the caller can pick the sink.
 */
export declare function openLink(input: {
    link: string;
    server: string;
    chain: string;
    sink: (name: string | null) => PlaintextSink;
    read?: ReadOptions;
}): Promise<OpenedLinkFile>;

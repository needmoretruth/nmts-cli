import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
export { addressFromTyped } from "./share.ts";
export { receivedShares, receiveShare } from "./sharing-inbox.ts";
export type { ReceivedFile, ReceivedShare } from "./sharing-inbox.ts";
/** An account as the share doors take it. */
export interface ShareAccount {
    readonly server: string;
    /** What the one auth header carries: an API key or a delegation token. */
    readonly bearer: string;
    readonly code: string;
    readonly accountId: string;
    /** The chain the stored parts are on, as `resolveNetwork` answers it. */
    readonly network: string;
    /** ⛔ base64url of the code's proof, for the sending and code doors only. Absent: not sent. */
    readonly accountProof?: string | undefined;
}
/** One file of the account's list that a share can carry, and its full path. */
export interface ShareableFile {
    readonly entry: ManifestEntry & {
        dekWrapped: string;
        contentHashCt: string;
    };
    readonly path: string;
}
/** What a sent share is: its id, the file's name, who it went to and from which code. */
export interface SentShare {
    id: string | null;
    name: string;
    /** The recipient's public code, readable form. */
    recipient: string;
    fromIndex: number;
}
/** The file at `target`, checked for the key and the hash a share carries. */
export declare function shareableFileAt(account: ShareAccount, target: string): Promise<ShareableFile>;
/**
 * Seal one file for one public code and send it.
 *
 * ⛔ THE CALLER HAS ALREADY DECIDED. The command asks its person between `shareableFileAt` and this
 *    call; a program decides by calling. Nothing here asks anybody anything.
 */
export declare function sendShare(account: ShareAccount, file: ShareableFile, recipientAddress: Uint8Array, options?: {
    as?: number | undefined;
    onFirstCode?: () => void;
}): Promise<SentShare>;
/** Who one file was shared with: the server's rows, unchanged, beside the file's path and id. */
export declare function sentShares(account: ShareAccount, target: string): Promise<{
    path: string;
    itemId: string;
    rows: unknown[];
}>;
/** Withdraw a share this account sent, or remove one it was sent. A copy already taken stays taken. */
export declare function removeShare(account: ShareAccount, id: string): Promise<void>;

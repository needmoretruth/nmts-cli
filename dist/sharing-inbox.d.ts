import type { PlaintextSink } from "./download-sink.ts";
import type { ShareAccount } from "./sharing.ts";
import type { ReadOptions } from "./walrus.ts";
/** One received share, opened as far as it would open. Its key never leaves this module. */
export interface ReceivedShare {
    id: string;
    itemId: string;
    /** The file's name and real length as the sender sealed them; null when the row would not open. */
    name: string | null;
    size: number | null;
    /** The sender's public code — only ever set when the open SUCCEEDED. */
    sender: string | null;
    senderRevoked: boolean;
    /** Which of this account's codes it came to, and that code readable. */
    toIndex: number;
    toCode: string;
    createdAt: string;
    /** Why it did not open, for a row that is still listed. */
    problem: string | null;
}
/** A received file, written to the sink and checked against the sender's hash. */
export interface ReceivedFile {
    id: string;
    name: string;
    bytes: number;
    parts: number;
    sender: string | null;
    senderRevoked: boolean;
    toIndex: number;
    toCode: string;
    /** False when the sink took the bytes but did not deliver them (it decides what that means). */
    delivered: boolean;
}
/**
 * Everything shared with this account, each row opened with the code it came to.
 *
 * ⛔ A ROW THAT WILL NOT OPEN IS STILL LISTED, with its reason and no sender. `total` can be larger
 *    than the list: the server's listing is bounded, and a caller that is not told cannot know.
 */
export declare function receivedShares(account: ShareAccount): Promise<{
    shares: ReceivedShare[];
    total: number;
}>;
/**
 * Receive one share into a sink: find its row in the list, open it, check what it says, then fetch.
 * `sinkFor` is asked once the name and real length are known — the command picks a path from the
 * sender's name there, and a program its own destination.
 */
export declare function receiveShare(account: ShareAccount, id: string, sinkFor: (file: {
    name: string;
    size: number;
}) => PlaintextSink, read?: ReadOptions): Promise<ReceivedFile>;

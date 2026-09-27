import type { CryptoGlue } from "./crypto.ts";
import type { PublicCodeList } from "./public-codes.ts";
/** One share sent from a code. */
export interface SentThrough {
    id: string;
    itemId: string;
    /** Where the file sits in this account, or null when the list no longer holds it. */
    path: string | null;
    /** The recipient's code in the form a person reads, or as the server sent it if it will not parse. */
    recipient: string;
    recipientRevoked: boolean;
    createdAt: string;
}
/** One share received with a code. */
export interface ReceivedThrough {
    id: string;
    /** The name its sender sealed, or null when it would not open — `problem` says why. */
    name: string | null;
    sender: string | null;
    senderRevoked: boolean;
    createdAt: string;
    problem: string | null;
}
export interface CodeActivity {
    sent: SentThrough[];
    received: ReceivedThrough[];
}
/** Where to ask and as whom — the account the code opens, on its server. */
export interface ActivityDoor {
    server: string;
    token: string;
    accountId: string;
}
/** Every code's shares, by number. A code with none has two empty lists. */
export declare function codeActivity(crypt: CryptoGlue, code: string, door: ActivityDoor, list: PublicCodeList): Promise<Map<number, CodeActivity>>;

/** The server's own ceilings on what one message may carry. */
export declare const MAX_MESSAGE_CHARS = 4000;
export declare const MAX_REPLY_CHARS = 8000;
export interface Wire {
    server: string;
    apiKey: string;
}
export declare function open(options: {
    server?: string | undefined;
}): Wire;
export declare function call(wire: Wire, path: string, init: {
    method?: "POST";
    body?: unknown;
}): Promise<unknown>;
export interface Message {
    fromOperator: boolean;
    body: string;
    createdAt: string;
    deletedAt: string | null;
}
export interface Ticket {
    id: string;
    code: string;
    category: string;
    subcategory: string | null;
    message: string;
    status: string;
    createdAt: string;
    lastReadAt: string | null;
    messages: Message[] | null;
}
export declare function asTicket(value: unknown): Ticket;
export declare function asList(value: unknown): {
    tickets: Ticket[];
    unread: number;
};
/** The date part of an instant. The time of day is noise in a list of reports. */
export declare function day(at: string): string;
export declare function requireCategory(given: string | undefined): string;
/**
 * The narrowing, checked against the category it was given with.
 *
 * ⚠ It is optional everywhere, and stays optional here: somebody who does not know which one
 *   applies must be able to send anyway.
 */
export declare function checkSub(category: string, given: string | undefined): string | null;
/** Values too short to name one thing would blank half the report, so they are refused. */
export declare function checkOmit(values: readonly string[]): string[];
export declare function requireLength(message: string, most: number, what: string): void;

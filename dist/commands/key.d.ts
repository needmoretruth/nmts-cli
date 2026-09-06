import type { ParsedArgs } from "../args.ts";
export interface KeyOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Comma-separated permission names: read, write, spend. */
    scopes?: string | undefined;
    /** How many days the key should last. The server clamps at its own ceiling. */
    days?: string | undefined;
    /** Put the key string on the screen as well. A person's act — see the header. */
    print?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
/**
 * `nmts key <verb>`.
 *
 * ⛔ A VERB AND NOT A BARE COMMAND, because the other verbs a person will look for here — listing
 *    the account's keys, revoking one — are things the server refuses to a key on purpose and
 *    would need the account code re-entered besides. `key` with no verb says which one exists
 *    rather than doing the only one it has, so `nmts key` never turns out to have made something.
 */
export declare function key(verb: string | undefined, args: ParsedArgs): Promise<number>;
/** Turn `read,write` into the bitmask the server takes, refusing anything it does not define. */
export declare function scopeMask(spelled: string): number;
export declare function keyNew(options?: KeyOptions): Promise<number>;

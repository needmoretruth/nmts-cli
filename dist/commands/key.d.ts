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
 * ⛔ A VERB AND NOT A BARE COMMAND. Three verbs: `new` mints, `list` shows, `revoke` cuts
 *    (`key-manage.ts` for the last two). All three present the account code's proof and none is
 *    reachable with a key — a key cannot cut another key off, and that is what makes revoking
 *    mean something. `key` with no verb says which ones exist rather than doing one of them, so
 *    `nmts key` never turns out to have made something.
 */
export declare function key(verb: string | undefined, args: ParsedArgs): Promise<number>;
/** Turn `read,write` into the bitmask the server takes, refusing anything it does not define. */
export declare function scopeMask(spelled: string): number;
/** The permission names a bitmask stands for, in the order they are defined. */
export declare function scopeNames(mask: number): string[];
export declare function keyNew(options?: KeyOptions): Promise<number>;

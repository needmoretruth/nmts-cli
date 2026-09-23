import type { ParsedArgs } from "../args.ts";
export interface AiAccountOptions {
    server?: string | undefined;
    json?: boolean;
    /** The tier gate's answer for the permanent act, or `--yes` under skip-permissions. */
    yes?: boolean;
    write?: (line: string) => void;
    /** Injected in tests: answers the one typed line. Its presence stands in for a terminal. */
    readLine?: (question: string) => Promise<string>;
}
/**
 * `nmts ai-account <verb>`.
 *
 * ⛔ THE BARE WORD LISTS, AND THAT IS THE SAFE HALF ON PURPOSE. A command whose bare form created
 *    something would make `ai-account` a thing somebody runs to find out what it does.
 */
export declare function aiAccount(verb: string | undefined, args: ParsedArgs): Promise<number>;
export declare function list(options?: AiAccountOptions): Promise<number>;
/**
 * Make one.
 *
 * ⛔ THE KEY IS PRINTED ONCE AND IS NOT STORED ANYWHERE. It is what the AI is given; this machine
 *    goes on being the account it already was. It can be derived again from this account's key and
 *    the place, which is the one thing that makes printing it here safe to have missed.
 */
export declare function create(asked: string | undefined, options?: AiAccountOptions): Promise<number>;
/**
 * Erase one.
 *
 * ⛔ IT IS THE SAME ERASURE THE ACCOUNT ITSELF WOULD RUN — the row, the files, the keys, the shares
 *    in both directions — and nothing undoes it. The typed sentence is `delete-account`'s, because
 *    it is the same act aimed at a different account.
 */
export declare function remove(id: string | undefined, options?: AiAccountOptions): Promise<number>;

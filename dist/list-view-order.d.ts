export type SortKey = "name" | "size" | "date";
export type SortDir = "asc" | "desc";
/** What `--sort` accepts, in the order the help text names them. */
export declare const SORT_KEYS: readonly SortKey[];
/** The fields ordering reads. Everything else about a row is the listing's business. */
export interface OrderableRow {
    name: string;
    /** Plaintext bytes. Folders carry 0. */
    size: number;
    /** Created, milliseconds since the Unix epoch. */
    createdAt: number;
    /** 0 folder · 1 file — the codes the sealed list stores. */
    kind: number;
    /** Held at the top of its group under every sort. Absent on rows that carry no mark. */
    pinned?: boolean;
}
/**
 * One of the three keys, or the refusal that names all three.
 *
 * ⛔ IT IS CHECKED BEFORE ANYTHING IS FETCHED. A misspelled key is a wrong command line, not a
 *    failing account, and an agent that read "could not list your files" after typing `--sort
 *    largest` would go looking at the account. Exit 2 says the same thing every other bad option
 *    in this tool says.
 */
export declare function parseSortKey(input: string): SortKey;
/**
 * Rows in the browser's order: folders first, then files, each group by the chosen key.
 *
 * The input array is left alone — a caller printing one order and counting over another would
 * otherwise depend on which of the two ran first.
 */
export declare function orderRows<T extends OrderableRow>(rows: readonly T[], sort: SortKey, dir: SortDir): T[];

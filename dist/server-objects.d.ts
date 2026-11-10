/** How many pages one walk follows. At the server's page size that is far past any real account. */
export declare const MAX_OBJECT_PAGES = 200;
/** One row the server holds. */
export interface ServerObject {
    id: string;
    /** True for a file in the trash: still held, on its way out. */
    trashed: boolean;
}
/** Every row, and whether the walk reached the end of the listing. */
export interface ServerObjects {
    rows: ServerObject[];
    /** False when the walk stopped at `MAX_OBJECT_PAGES`. ⛔ A cut walk is never "that was all". */
    complete: boolean;
}
/**
 * Every row the server holds for the account `token` speaks for.
 *
 * ⛔ A ROW THIS CANNOT READ IS A REFUSAL. Skipping one would shrink the set of things the server is
 *    known to hold, which each caller then acts on as if it were whole.
 */
export declare function serverObjects(base: string, token: string): Promise<ServerObjects>;

// Every row the NMTS server holds for an account, live or trashed — read with nothing but the
// account's credential.
//
// ⛔ `/v1/objects` AND NOT `/v1/items?deleted=true`. The trash listing stops at the retention window,
//    so a row that is past thirty days and not yet erased is missing from it. `/v1/objects` is the
//    reconciliation view: every row of the account, with no window on it, and no name — the layer a
//    caller without the NMTS key can use (`api/src/routes/items.rs`, `list_objects`).
//
// ⛔ ONE PAGER FOR EVERY CALLER. `nmts sweep`, `rebuild` and an operator keeping a user's files alive
//    all walk this listing; three copies of the cursor loop were three places to disagree about what
//    an unreadable row means.
//
// ⚠ The two calls are written out rather than built from a variable so that the gate comparing this
//   tool's addresses against the server's routes (`check:cli-routes`) can see them both. It reads
//   literal strings.
import { request } from "./api.js";
import { NmtsError } from "./errors.js";
/** How many pages one walk follows. At the server's page size that is far past any real account. */
export const MAX_OBJECT_PAGES = 200;
/**
 * Every row the server holds for the account `token` speaks for.
 *
 * ⛔ A ROW THIS CANNOT READ IS A REFUSAL. Skipping one would shrink the set of things the server is
 *    known to hold, which each caller then acts on as if it were whole.
 */
export async function serverObjects(base, token) {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < MAX_OBJECT_PAGES; page += 1) {
        const answer = cursor === null
            ? await request(base, "/v1/objects", { token })
            : await request(base, `/v1/objects?after=${encodeURIComponent(cursor)}`, { token });
        const read = asObjectsAnswer(answer);
        rows.push(...read.rows);
        if (read.next === null)
            return { rows, complete: true };
        cursor = read.next;
    }
    return { rows, complete: false };
}
/** What `GET /v1/objects` answers, narrowed rather than trusted. */
function asObjectsAnswer(value) {
    const unreadable = () => {
        throw new NmtsError("The server answered with an item listing this version cannot read.", {
            nextStep: "Nothing was changed. Update this tool.",
        });
    };
    if (typeof value !== "object" || value === null)
        return unreadable();
    const raw = Reflect.get(value, "objects");
    if (!Array.isArray(raw))
        return unreadable();
    const objects = raw;
    const rows = [];
    for (const object of objects) {
        if (typeof object !== "object" || object === null)
            return unreadable();
        const id = Reflect.get(object, "id");
        if (typeof id !== "string")
            return unreadable();
        const deleted = Reflect.get(object, "deleted_at");
        rows.push({ id, trashed: typeof deleted === "string" && deleted !== "" });
    }
    const next = Reflect.get(value, "next_cursor");
    if (next !== null && next !== undefined && typeof next !== "string")
        return unreadable();
    return { rows, next: typeof next === "string" && next !== "" ? next : null };
}

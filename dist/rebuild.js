// Building an account's sealed file list back out of the rows the server still holds.
//
// ⛔ AN ACCOUNT WITH NO FILE LIST IS NOT AN EMPTY ACCOUNT. Names, folders and every file's key
//    live in one sealed blob the server cannot read. When that blob is missing — an account older
//    than the list, or one whose first write never landed — the FILES are still there: the server
//    keeps a row per stored file, and each row carries the wrapped key the file was committed
//    with. So "no list" means "nothing can be named yet", never "nothing is stored".
//
// ⛔ WHAT COMES BACK, AND WHAT CANNOT. The server was deliberately made to forget names, folders
//    and placement — that is the whole point of sealing the list — so a rebuild produces a FLAT
//    drive of placeholder names. What it recovers is everything that cannot be recreated by hand:
//      · the wrapped file key, without which the bytes are gone for good rather than merely unnamed
//      · the sealed content hash, so a later download still verifies
//      · the real dates, so "oldest first" still means something
//      · the size, and whether the file was in the trash
//    The trade is deliberate: a person retypes a name in seconds; nobody can regenerate a key.
//
// ⛔ NOTHING MAY BE DROPPED, SO A SHORT LISTING STOPS THE REBUILD. A page that could not be read,
//    a cursor that repeats, or a listing longer than this will read are all refusals here. A
//    rebuild that silently skipped rows would seal a list that is missing files, and every device
//    would then agree those files do not exist — while the account goes on paying for them. An
//    account left un-rebuilt is recoverable; a short list written over nothing is not.
//
// ⛔ THE TRASH IS PART OF IT. Trashed files are still stored, still charged for and still
//    restorable, so a list built from the live rows alone would empty the trash of an account that
//    rebuilt. ⚠ The server's trash view ends at the restore window: something thrown away longer
//    ago than that is not in any listing this can read, and is counted and reported rather than
//    passed over in silence.
import { request } from "./api.js";
import { NmtsError } from "./errors.js";
import { KIND_FILE } from "./shared/lib/drive/manifest-index.js";
import { uniqueFileName } from "./shared/lib/drive/unique-name.js";
/**
 * How many pages of one listing a rebuild will read.
 *
 * ⛔ THERE IS A CEILING BECAUSE A REBUILD MUST NOT RUN FOREVER, and there is a REFUSAL at the
 *    ceiling because "absent from a listing that ran out of patience" is not "not stored". A
 *    hundred rows a page puts this well past any drive a command-line tool is the right way to
 *    manage; an account past it has to be rebuilt in a browser, which pages without a limit.
 */
const MAX_PAGES = 200;
/**
 * Stand-in name for a file the server can no longer name. Deliberately not a sentence and
 * deliberately language-neutral: it sits in the field a person's own file names sit in, and the
 * only thing to do with it is type over it.
 */
export function placeholderName(id) {
    return `recovered-${id.replace(/-/g, "").slice(0, 8)}`;
}
/** RFC3339 → epoch ms. An unreadable stamp becomes 0: obviously wrong, and it still sorts. */
function instant(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : 0;
}
function unreadable() {
    throw new NmtsError("The server answered with an item listing this version cannot read.", {
        exitCode: 4,
        nextStep: "Nothing was written. A row this tool cannot read is a file it would leave out of the " +
            "rebuilt list, so it stops instead. Update this tool, or rebuild the account in a browser.",
    });
}
function stringField(row, name) {
    const value = Reflect.get(row, name);
    return typeof value === "string" ? value : unreadable();
}
/** A field that may be absent or null, and must be a string when it is neither. */
function optionalString(row, name) {
    const value = Reflect.get(row, name);
    if (value === undefined || value === null)
        return null;
    return typeof value === "string" ? value : unreadable();
}
function itemFrom(row) {
    if (typeof row !== "object" || row === null)
        return unreadable();
    const size = Reflect.get(row, "size");
    if (typeof size !== "number" || !Number.isFinite(size))
        return unreadable();
    const deletedAt = optionalString(row, "deleted_at");
    const dekWrapped = optionalString(row, "dek_wrapped");
    const contentHashCt = optionalString(row, "content_hash_ct");
    return {
        id: stringField(row, "id"),
        size,
        createdAt: instant(stringField(row, "created_at")),
        updatedAt: instant(stringField(row, "updated_at")),
        ...(deletedAt === null ? {} : { deletedAt: instant(deletedAt) }),
        ...(dekWrapped === null ? {} : { dekWrapped }),
        ...(contentHashCt === null ? {} : { contentHashCt }),
    };
}
/**
 * What `GET /v1/items` answers, narrowed rather than trusted.
 *
 * ⛔ A ROW THIS CANNOT READ IS A REFUSAL, not a row to skip. Every row skipped here is a file that
 *    would be missing from the sealed list, and a file missing from the list is one no device can
 *    ever name or open again.
 */
function asItemsAnswer(value) {
    if (typeof value !== "object" || value === null)
        return unreadable();
    const raw = Reflect.get(value, "items");
    if (!Array.isArray(raw))
        return unreadable();
    const rows = raw;
    const items = rows.map(itemFrom);
    const next = Reflect.get(value, "next_cursor");
    if (next !== null && next !== undefined && typeof next !== "string")
        return unreadable();
    return { items, next: typeof next === "string" && next !== "" ? next : null };
}
/**
 * One page of the account's own items, live or trashed.
 *
 * ⚠ The four addresses are written out rather than built from a variable so that the gate
 *   comparing this tool's addresses against the server's routes can see them. It reads literals.
 */
async function itemsPage(base, apiKey, trash, cursor) {
    const after = cursor === null ? "" : `after=${encodeURIComponent(cursor)}`;
    const answer = trash
        ? await request(base, `/v1/items?deleted=true${after === "" ? "" : `&${after}`}`, { token: apiKey })
        : await request(base, `/v1/items${after === "" ? "" : `?${after}`}`, { token: apiKey });
    return asItemsAnswer(answer);
}
/**
 * Read one whole listing, or refuse.
 *
 * ⛔ A REPEATED CURSOR IS A REFUSAL TOO. The cursor is the server's, and it is meant to move; one
 *    that comes back a second time would spin this loop until the ceiling and then report an
 *    account too large to rebuild, which is a lie about what went wrong.
 */
async function readListing(base, apiKey, trash, onProgress) {
    const out = [];
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await itemsPage(base, apiKey, trash, cursor);
        // One at a time rather than a spread: a spread passes every element as a call ARGUMENT, and
        // the largest account this ever meets must not be the one that overflows the stack.
        for (const item of answer.items)
            out.push(item);
        onProgress?.(out.length);
        if (answer.next === null)
            return out;
        if (seenCursors.has(answer.next)) {
            throw new NmtsError("The server's item listing repeated a page marker.", {
                exitCode: 4,
                nextStep: "Nothing was written. A listing that does not move cannot be read to the end, and a " +
                    "rebuild from a partial one would leave files out of the list for good.",
            });
        }
        seenCursors.add(answer.next);
        cursor = answer.next;
    }
    throw new NmtsError("This account has more stored files than one rebuild will read.", {
        exitCode: 4,
        nextStep: "Nothing was written. Rebuilding from a listing that stopped early would seal a list " +
            "missing the files it never reached, and every device would then treat them as gone. " +
            "Rebuild this account in a browser instead.",
    });
}
/**
 * Every id the server holds a row for, live or trashed, with no window on it.
 *
 * ⚠ THIS IS A CROSS-CHECK, NOT A SOURCE. It carries no keys, so nothing here can be rebuilt from
 *   it — it exists to turn "some rows were not recovered" from something nobody notices into a
 *   number printed before anybody agrees to anything. A listing that stops early makes the check
 *   unavailable, which is reported as unknown rather than as zero.
 */
async function serverRowIds(base, apiKey) {
    const ids = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = cursor === null
            ? await request(base, "/v1/objects", { token: apiKey })
            : await request(base, `/v1/objects?after=${encodeURIComponent(cursor)}`, { token: apiKey });
        if (typeof answer !== "object" || answer === null)
            return null;
        const raw = Reflect.get(answer, "objects");
        if (!Array.isArray(raw))
            return null;
        const rows = raw;
        for (const row of rows) {
            if (typeof row !== "object" || row === null)
                return null;
            const id = Reflect.get(row, "id");
            if (typeof id !== "string")
                return null;
            ids.add(id);
        }
        const next = Reflect.get(answer, "next_cursor");
        if (typeof next !== "string" || next === "")
            return ids;
        cursor = next;
    }
    return null;
}
/**
 * Turn the server's rows into entries.
 *
 * ⛔ EVERY REBUILT FILE SITS AT THE TOP OF THE DRIVE, because the server has no folder or parent
 *    left to report and inventing one would be a guess presented as a memory.
 *
 * ⛔ AND NO TWO OF THEM SHARE A NAME. A placeholder is the first characters of an id, so two ids
 *    can produce one name; in a drive addressed by path, two entries with the same path is a
 *    lookup this tool refuses rather than resolves — a file nobody can fetch. Numbering the second
 *    one costs nothing and the person is going to rename both anyway.
 */
export function entriesFrom(items) {
    const taken = new Set();
    return items.map((item) => {
        const name = uniqueFileName(placeholderName(item.id), taken);
        taken.add(name);
        return {
            id: item.id,
            parentId: null,
            kind: KIND_FILE,
            name,
            size: item.size,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            ...(item.deletedAt === undefined ? {} : { deletedAt: item.deletedAt }),
            ...(item.dekWrapped === undefined ? {} : { dekWrapped: item.dekWrapped }),
            ...(item.contentHashCt === undefined ? {} : { contentHashCt: item.contentHashCt }),
        };
    });
}
/**
 * Read the whole account and work out the list it would be sealed as. Writes nothing.
 *
 * ⛔ THE TRASH IS READ SECOND AND WINS A TIE. An item thrown away between the two listings comes
 *    back in both; the trashed row is the newer truth, and taking the live one would resurrect
 *    something the person had just thrown away.
 */
export async function rebuildFromServer(input) {
    const live = await readListing(input.server, input.apiKey, false, input.onProgress);
    const liveCount = live.length;
    const trashed = await readListing(input.server, input.apiKey, true, (read) => input.onProgress?.(liveCount + read));
    const byId = new Map();
    for (const item of live)
        byId.set(item.id, item);
    for (const item of trashed)
        byId.set(item.id, item);
    const items = [...byId.values()];
    const entries = entriesFrom(items);
    const held = await serverRowIds(input.server, input.apiKey);
    const unaccounted = held === null ? null : [...held].filter((id) => !byId.has(id)).length;
    return {
        entries,
        live: items.filter((item) => item.deletedAt === undefined).length,
        trashed: items.filter((item) => item.deletedAt !== undefined).length,
        keyless: items.filter((item) => item.dekWrapped === undefined).length,
        unaccounted,
    };
}

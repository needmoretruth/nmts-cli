// Reading the account's storage dump — every live file and where its bytes are — one page at a time.
//
// ⛔ WHY A DUMP AND NOT THE ORDINARY LISTING. The drive listing is per folder and carries no
//    storage parts; building a list from it would cost one request per folder plus one per file.
//    This returns the whole account, parts included, 500 at a time.
//
// ⛔ EVERY PAGE CARRIES THE ACCOUNT PROOF. The route's verdict is `NeedsAccountProof`: an API key
//    alone is refused, whatever its permissions. `account-proof.ts` says what the value is, why
//    sending it is safe, and what it can still do if it is stolen.
//
// ⛔ NOTHING HERE TRUSTS THE ANSWER'S SHAPE. It arrives as `unknown` and is narrowed by predicates
//    rather than asserted, because the whole point of the artefact being built from it is that the
//    server may one day be hostile or broken. A row this cannot read is a refusal, never a skip: a
//    list quietly missing a file tells somebody they are covered when they are not.
//
// ⚠ ITEMS CREATED DURING THE WALK may or may not appear, depending on where their id sorts. That
//   is why the caller stamps the moment the walk BEGAN and sends that as the capture time — a file
//   made while the pages were being read then counts as outside the list rather than falling into
//   the gap between the two.
import { request } from "./api.js";
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
import { plaintextLenFromSealed } from "./seal.js";
/** `file_parts.storage_kind` for a quilt patch. 0 is a dedicated blob. */
export const STORAGE_QUILT = 1;
function unreadable(what) {
    return new NmtsError(`The server described ${what} in a shape this version cannot read.`, {
        exitCode: 1,
        nextStep: "Nothing was written. Update this tool, or build the recovery list from the account " +
            "screen in a browser — a list that skipped what it could not read would claim to cover " +
            "files it does not.",
    });
}
function str(row, name, what) {
    const value = row[name];
    if (typeof value !== "string" || value.length === 0)
        throw unreadable(`${what} (${name})`);
    return value;
}
function optionalStr(row, name) {
    const value = row[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function whole(row, name, what) {
    const value = row[name];
    if (typeof value !== "number" || !Number.isSafeInteger(value))
        throw unreadable(`${what} (${name})`);
    return value;
}
function partOf(value, itemId) {
    if (!isRecord(value))
        throw unreadable(`a stored part of file ${itemId}`);
    const what = `a stored part of file ${itemId}`;
    const sealedLen = whole(value, "sealed_len", what);
    const part = {
        part_index: whole(value, "part_index", what),
        storage_kind: whole(value, "storage_kind", what),
        blob_id: str(value, "blob_id", what),
        sealed_len: sealedLen,
        // Throws on a length no honest upload could have produced, which is exactly the number a
        // recovery list must not record.
        streamPlaintextLen: plaintextLenFromSealed(sealedLen),
    };
    const network = value["network"];
    if (typeof network === "number" && Number.isSafeInteger(network))
        part.network = network;
    const patch = optionalStr(value, "patch_id");
    if (patch !== undefined)
        part.patch_id = patch;
    const object = optionalStr(value, "sui_object_id");
    if (object !== undefined)
        part.sui_object_id = object;
    return part;
}
function itemOf(value) {
    if (!isRecord(value))
        throw unreadable("a stored file");
    const id = str(value, "id", "a stored file");
    const parts = value["parts"];
    if (!Array.isArray(parts))
        throw unreadable(`the stored parts of file ${id}`);
    const item = {
        id,
        size: whole(value, "size", `stored file ${id}`),
        createdAt: str(value, "created_at", `stored file ${id}`),
        updatedAt: str(value, "updated_at", `stored file ${id}`),
        parts: parts.map((p) => partOf(p, id)),
    };
    const dek = optionalStr(value, "dek_wrapped");
    if (dek !== undefined)
        item.dekWrapped = dek;
    const hash = optionalStr(value, "content_hash_ct");
    if (hash !== undefined)
        item.contentHashCt = hash;
    return item;
}
/**
 * Read every page of the dump, oldest cursor first.
 *
 * ⛔ A REPEATED CURSOR IS A REFUSAL, NOT A LOOP. The cursor is server-issued and strictly
 *    increasing, but a bug — or a hand-edited answer — that repeated one would spin here forever
 *    with nothing to show for it.
 */
export async function readAllRecoverySource(options) {
    const items = [];
    const seen = new Set();
    let cursor;
    do {
        // ⚠ `after` IS ALWAYS SPELLED OUT, empty on the first page. The server reads an empty value as
        //   "from the beginning" — and one shape for the address is what lets the route gate read this
        //   call and compare it against what the server actually registers.
        // ⚠ THE VALUE IS PREPARED OUTSIDE THE ADDRESS, and not for tidiness: `check:cli-routes` reads
        //   the literal handed to `request` and its reader stops at a quote character, so a `""`
        //   written inside the template would take this call out of the gate's sight entirely — the
        //   exact failure that gate was built for. Proved by breaking the address and watching it go
        //   red.
        const after = cursor === undefined ? "" : cursor;
        const answer = await request(options.server, `/v1/account/recovery-source?after=${encodeURIComponent(after)}`, { token: options.apiKey, accountProof: options.accountProof });
        if (!isRecord(answer))
            throw unreadable("this account's stored files");
        const page = answer["items"];
        if (!Array.isArray(page))
            throw unreadable("this account's stored files");
        for (const row of page)
            items.push(itemOf(row));
        options.onProgress?.(items.length);
        const next = answer["next_cursor"];
        if (next === undefined || next === null)
            return items;
        if (typeof next !== "string" || next.length === 0)
            throw unreadable("the next page of files");
        if (seen.has(next)) {
            throw new NmtsError("The account's stored files repeated a page marker.", {
                exitCode: 1,
                nextStep: "Nothing was written. The listing cannot be read to the end, so a list built from it " +
                    "would be missing files without saying so.",
            });
        }
        seen.add(next);
        cursor = next;
    } while (cursor !== undefined);
    return items;
}

// Where an unfinished PAID upload waits.
//
// ⛔ THIS FILE EXISTS BECAUSE THE CREDITS MOVE BEFORE THE BYTES DO. `POST /v1/sponsored/reserve`
//    spends the account's credits and buys storage on the network; only after that do the bytes
//    go to the relay. A process that dies in between has bought storage it never filled, and a
//    plain retry would buy a second lot. What makes the retry free instead is sending the SAME
//    idempotency key with the SAME blob — and the blob id is a function of the sealed bytes and a
//    random tip nonce, neither of which can be re-derived once they are gone.
//
//    So they are written down BEFORE the money moves. That ordering is the whole design.
//
// ⛔ WHAT IS KEPT IS ALREADY PUBLIC. The `.bin` half is the sealed NCF-3 stream — the exact bytes
//    about to be handed to a public storage network. The host still keeps it as privately as it
//    can (0600 on this machine), because "already public" is about the CONTENT and the record's
//    presence would otherwise say which files this account uploaded and when.
//
// ⛔ THE KEY IS NOT A CONTENT FINGERPRINT. Keying by SHA-256 of the plaintext would leave a store
//    of hashes matchable against published hash sets — the very thing sealing the content hash
//    avoids. The key mixes the account's data key in, so it identifies the file only to somebody
//    who already holds the account.
import { sha256 } from "@noble/hashes/sha2.js";
import { fromUtf8, toBase64Url, utf8 } from "./bytes.js";
import { NmtsError } from "./errors.js";
import { host } from "./host.js";
/** The area of the host's state these records live in. One key per file below it. */
const AREA = "uploads";
/**
 * A stable, account-scoped name for one file's upload attempt.
 *
 * Same account, same bytes, same destination give the same key — which is what lets a second `put`
 * of a file whose first attempt died find the reservation instead of paying again.
 *
 * ⛔ THE DESTINATION IS PART OF IT, and leaving it out was a real defect. Two local files with
 *    identical content — a copy, a re-download, `a.bin` and `backup/a.bin` — would otherwise share
 *    one reservation, and putting the second one would silently resume the first: it would report
 *    success, spend nothing, and write a SECOND file-list entry pointing at the FIRST file's item.
 *    Deleting either would then break the other. They are two files in the drive, so they are two
 *    uploads.
 *
 * ⚠ It is the destination AS TYPED, not the folder id, because the id needs a network round trip
 *   and this key is wanted before one. Two spellings of one folder therefore make two reservations
 *   — one extra unfinished record, never a wrong file.
 */
export function reservationKey(dataKey, plaintext, name, destination) {
    return reservationKeyStreamed(dataKey, [plaintext], name, destination);
}
/**
 * The same key, computed without ever holding the file.
 *
 * ⛔ IT MUST HASH THE IDENTICAL BYTE SEQUENCE. A file large enough to need several parts is a file
 *    too large to hand `reservationKey` as one array, and a second construction here — hashing a
 *    hash, hashing the parts' digests — would give the same file two different keys depending on
 *    how it was read. The one above is written in terms of this one so there is only ever one
 *    answer, and a test feeds the same file both ways to hold that.
 */
export function reservationKeyStreamed(dataKey, plaintextChunks, name, destination) {
    const hash = startReservationKey(dataKey);
    for (const chunk of plaintextChunks)
        hash.update(chunk);
    return finishReservationKey(hash, name, destination);
}
/**
 * Begin the hash a reservation key is made from.
 *
 * ⛔ TWO HASHES, ONE READ. A file large enough to need parts is read once to work out its key AND
 *    the SHA-256 the account checks its contents against; handing the caller the running hash is
 *    what lets both come out of a single pass instead of two reads of a very large file.
 */
export function startReservationKey(dataKey) {
    return sha256.create().update(dataKey);
}
/** Finish it. The name and the destination go in last, exactly as the one-shot form does. */
export function finishReservationKey(hash, name, destination) {
    const digest = hash.update(utf8(`\u0000${name}\u0000${destination}`)).digest();
    return toBase64Url(digest).slice(0, 32);
}
/**
 * The record name for ONE part of a file.
 *
 * ⛔ EVERY PART IS ITS OWN RESERVATION. Each one buys its own storage, under its own idempotency
 *    key, and can fail or resume on its own — so each one is written down on its own. Sharing a
 *    record between parts would mean a run that died between part 3 and part 4 could not say which
 *    of them the credits had already been spent on.
 */
export function partKey(fileKey, partIndex) {
    return `${fileKey}~p${partIndex}`;
}
/** The two keys one part's reservation occupies: its record, and the sealed bytes it bought. */
function keysFor(key) {
    return { json: `${AREA}/${key}.json`, bin: `${AREA}/${key}.bin` };
}
function isReservation(value) {
    if (typeof value !== "object" || value === null)
        return false;
    for (const name of ["blobId", "nonceB64", "rootHashB64", "relayUrl", "dekWrapped", "contentHashCt", "name"]) {
        if (typeof Reflect.get(value, name) !== "string")
            return false;
    }
    for (const name of ["epochs", "sealedLen", "plaintextLen", "partPlaintextLen", "partIndex", "partTotal", "attempt"]) {
        if (typeof Reflect.get(value, name) !== "number")
            return false;
    }
    const parent = Reflect.get(value, "parentId");
    return parent === null || typeof parent === "string";
}
/**
 * The waiting reservation's RECORD, without its sealed bytes.
 *
 * ⛔ THE BYTES ARE THE FILE. Reading them to answer "has this part been paid for?" would mean a
 *    resume that only needs to commit still reads every byte of a very large upload off the disk.
 *    They are fetched separately, by the one step that actually pushes them.
 */
export async function readReservationRecord(key) {
    const { json, bin } = keysFor(key);
    const state = host().state;
    const held = await state.read(json);
    if (held === undefined || (await state.read(bin)) === undefined)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(fromUtf8(held));
    }
    catch {
        // ⛔ Unreadable is not the same as absent, and treating it as absent would buy storage twice.
        throw new NmtsError(`The unfinished upload record ${json} could not be read.`, {
            nextStep: "It names storage this account may already have paid for. Move it aside rather than " +
                "deleting it if the upload matters, then try again.",
        });
    }
    if (!isReservation(parsed)) {
        throw new NmtsError(`The unfinished upload record ${json} is not in a shape this version knows.`, {
            nextStep: "Move it aside and try again. Nothing was sent.",
        });
    }
    return parsed;
}
/**
 * The sealed bytes a reservation bought.
 *
 * ⛔ NEVER RE-SEALED ONES. Sealing is non-deterministic, so bytes produced by a later run are a
 *    different blob from the one the treasury registered — the relay refuses them, forever, and
 *    the credits are gone.
 */
export async function readReservationBytes(key) {
    const { bin } = keysFor(key);
    const held = await host().state.read(bin);
    if (held === undefined) {
        throw new NmtsError(`The sealed bytes of ${bin} are gone.`, {
            nextStep: "Nothing was sent. The storage they bought cannot be filled by re-sealing — run the " +
                "upload again to buy storage for a fresh sealing of the same file.",
        });
    }
    return held;
}
/** The record and its bytes together, for the callers that need both. */
export async function readReservation(key) {
    const record = await readReservationRecord(key);
    if (record === null)
        return null;
    return { record, sealed: await readReservationBytes(key) };
}
/** Write the record and its sealed bytes. Called BEFORE the reserve, and again after it answers. */
export async function writeReservation(key, record, sealed) {
    const { json, bin } = keysFor(key);
    // ⛔ THE BYTES GO DOWN FIRST, AND THE RECORD IS WHAT MAKES THE PAIR COUNT. A reader treats a
    //    record without its bytes as no reservation at all, so a run that stopped between these two
    //    writes leaves nothing that can be resumed — rather than a record pointing at bytes that are
    //    not there. Each write on its own is all-or-nothing; that is the host's promise, and the
    //    write that matters most is the LAST one, because a half-written record is the only local
    //    pointer to a file that is already paid for.
    const state = host().state;
    await state.write(bin, sealed);
    await state.write(json, utf8(`${JSON.stringify(record, null, 2)}\n`));
}
/**
 * Forget a reservation.
 *
 * ⚠ Called on success AND on a couple of failure paths, so the comment that used to say "the
 *   upload already succeeded" was not true of every caller. What IS true of all of them is that
 *   nothing further depends on the record, which is why it never throws.
 */
export async function clearReservation(key) {
    const { json, bin } = keysFor(key);
    for (const name of [json, bin]) {
        try {
            await host().state.remove(name);
        }
        catch {
            // ⚠ A record that cannot be removed is left where it is. That is not free -- a record
            //   carrying an item id is READ before anything is written, so a stale one would be
            //   resumed rather than overwritten. It is still better than failing a finished upload
            //   over a file that could not be deleted.
        }
    }
}
function itemKey(fileKey) {
    return `${AREA}/${fileKey}.item.json`;
}
function isItemRecord(value) {
    if (typeof value !== "object" || value === null)
        return false;
    if (typeof Reflect.get(value, "attempt") !== "number")
        return false;
    const id = Reflect.get(value, "itemId");
    return id === undefined || typeof id === "string";
}
/** What is known about this file's commit, or `null` when it has not been attempted. */
export async function readItemRecord(fileKey) {
    const path = itemKey(fileKey);
    const held = await host().state.read(path);
    if (held === undefined)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(fromUtf8(held));
    }
    catch {
        // ⛔ Same reasoning as an unreadable reservation: unreadable is not absent. This file is the
        //    only local pointer to storage that is already bought and possibly already committed.
        throw new NmtsError(`The unfinished upload record ${path} could not be read.`, {
            nextStep: "It names a file this account may already have paid for. Move it aside rather than " +
                "deleting it if the upload matters, then try again.",
        });
    }
    if (!isItemRecord(parsed)) {
        throw new NmtsError(`The unfinished upload record ${path} is not in a shape this version knows.`, {
            nextStep: "Move it aside and try again. Nothing was sent.",
        });
    }
    return parsed;
}
/** Write the file-level record. Called before the commit, and again once it has an id. */
export async function writeItemRecord(fileKey, record) {
    await host().state.write(itemKey(fileKey), utf8(`${JSON.stringify(record, null, 2)}\n`));
}
/** Forget the file-level record. Never throws, for the same reason `clearReservation` does not. */
export async function clearItemRecord(fileKey) {
    try {
        await host().state.remove(itemKey(fileKey));
    }
    catch {
        // ⚠ Left where it is. A stale one carrying an item id would be resumed rather than
        //   overwritten, which is still better than failing a finished upload over a stuck file.
    }
}

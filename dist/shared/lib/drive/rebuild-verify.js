// Checking that a rebuilt file list pairs each KEY with the file it actually opens. ⚠ PUBLISHED —
// copied byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ WHY THIS EXISTS. A rebuild takes each server row's wrapped file key (`dek_wrapped`) and pairs
//    it with the item as the server presents it. The wrapped key is sealed under a FIXED domain
//    separator (`nmts/v3/dek-wrap`, NCF-3 §2.2) and NOT under the item's id, so every one of an
//    account's wrapped keys opens under the same account key — which means a server that handed
//    back row A's key beside row B's id would produce a list whose pairs are wrong, and every
//    check on this side would pass. The mistake is invisible because rebuilt names are
//    placeholders, and it is then SEALED into the list and carried into the recovery list.
//
// ⛔ WHY NOTHING FALSE IS EVER READ, AND WHY THAT IS NOT ENOUGH. A part decrypted with the wrong
//    key fails at its authentication tag, so a wrong pair is a file that will not open — never
//    wrong bytes. What the wrong pair does is PERSIST: it is written into the sealed list, it
//    survives every later edit, and the day somebody tries to open the file is years after the
//    day the pairing could still have been worked out from what the server held.
//
// ⭐ THE CHECK IS ONE HEADER, NOT ONE FILE. NCF-3 §4.1 puts a 72-byte plaintext header in front of
//    every sealed part, and §4.2 puts a key commitment in it — `HKDF(ikm = DEK, salt = nonce_prefix,
//    info = "nmts/v3/stream-commit" || header[0..40])` — which the decryptor recomputes and
//    compares IN CONSTANT TIME BEFORE ANY CHUNK IS DECRYPTED. So opening a part's header with a
//    key either succeeds or does not, and neither answer needs a single byte of ciphertext, a tag,
//    or a chunk. That is what makes verifying a whole account affordable: one 72-byte ranged read
//    per file, on the read path the download engine already uses.
//
// ⛔ A PAIR THAT DOES NOT OPEN IS NOT WRITTEN WITH A KEY. It keeps its entry — the row, the size
//    and the dates are real, and an entry is what says the file was there — but the key stays off
//    it, because a key written beside the wrong file is a claim this side cannot make. The count
//    and the reasons come back to the caller so a screen or a command can say which is which.
//
// ⛔ EVERY UNKNOWN ANSWER IS "UNVERIFIED", never "verified". A read that timed out, an aggregator
//    that is down, a part row that is missing: none of them is evidence that the key belongs to
//    the file, and treating them as evidence is exactly how the defect this file closes came back.
/** Bytes of one sealed part that decide the question (NCF-3 §4.1 header, §4.2 commitment). */
export const NCF3_HEADER_BYTES = 72;
/**
 * How many of these reads are in flight at once.
 *
 * Small on purpose: it is one tiny range request per file against the public aggregators, and a
 * rebuild is not a download — going wider would spend an account's whole read budget on 72-byte
 * requests and make the progress line lie about what is happening.
 */
export const REBUILD_VERIFY_CONCURRENCY = 4;
/**
 * Decide, for every row, whether its key belongs to it.
 *
 * A row with no key is answered here rather than by the caller's reader: there is nothing to
 * fetch, and spending a request to learn that would be a request per keyless file.
 */
export async function verifyKeyPairings(input) {
    const { rows, openFirstPartHeader, onProgress } = input;
    const total = rows.length;
    // Answers are parked BY POSITION and read back in order at the end: the pool finishes them in
    // whatever order the network allows, and a list of problems in network order is a list whose
    // order changes every run.
    const verdicts = new Array(total);
    let checked = 0;
    // The same bounded runner the relay pool probes with: a shared cursor and N workers walking it,
    // so at most N reads are open and nothing is queued that will not be started.
    let next = 0;
    const worker = async () => {
        while (next < total) {
            const at = next;
            next += 1;
            const row = rows[at];
            if (row === undefined)
                continue;
            verdicts[at] =
                row.dekWrapped === undefined || row.dekWrapped === ""
                    ? { ok: false, reason: "no-key" }
                    : await attempt(openFirstPartHeader, row);
            checked += 1;
            onProgress?.(checked, total);
        }
    };
    const workers = Math.min(Math.max(input.concurrency ?? REBUILD_VERIFY_CONCURRENCY, 1), total);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    const verified = new Set();
    const unverified = [];
    for (let at = 0; at < total; at += 1) {
        const row = rows[at];
        if (row === undefined)
            continue;
        const verdict = verdicts[at];
        // An absent verdict cannot happen while the loop above covers every position, and if it ever
        // did it would mean "not checked" — which is `unverified`, because the alternative is a key
        // written on the strength of a read nobody made.
        if (verdict !== undefined && verdict.ok)
            verified.add(row.id);
        else
            unverified.push({ id: row.id, reason: verdict === undefined ? "unreadable" : verdict.reason });
    }
    return { verified, unverified };
}
/** Run one attempt, turning a thrown reader into the verdict it should have returned. */
async function attempt(open, row) {
    try {
        return await open(row);
    }
    catch {
        return { ok: false, reason: "unreadable" };
    }
}
/**
 * True when this row's key may be written into the rebuilt list.
 *
 * Both rebuild paths ask this one question rather than each testing the set themselves, because
 * "which way round is the set" is exactly the kind of thing two copies get differently.
 */
export function mayCarryKey(id, verdicts) {
    return verdicts.verified.has(id);
}

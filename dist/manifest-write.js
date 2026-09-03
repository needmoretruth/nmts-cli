// Writing the sealed file list — the step that turns a stored file into a visible one.
//
// ⛔ A FILE THAT IS NOT IN THIS LIST DOES NOT EXIST TO ITS OWNER. The server knows a file was
//    committed and charges for it; the NAME, the folder and the key that opens it live only here,
//    sealed under a key the server does not have. So this is the last step of an upload and the
//    one that must not be skipped after the money moved.
//
// ⛔ THE WHOLE LIST IS REWRITTEN EVERY TIME. There is no "append" on the wire — the blob is sealed
//    as one piece. That is why this re-reads immediately before writing: the version it builds on
//    has to be the current one, and anything another device added since must be carried forward,
//    not overwritten.
//
// ⛔ WHAT PROTECTS AGAINST BUILDING ON A STALE LIST. Three things, and none of them alone:
//      · this machine's own record refuses a list older than one it already saw;
//      · the server's compare-and-swap on `base_seq` refuses a write built on a version it has
//        already moved past — which is what catches an ordinary race between two devices;
//      · the `prev` link inside the blob makes a fork visible to the NEXT reader on any device.
//    The account's own settings ride along for the same reason: they live in this blob or nowhere,
//    so rewriting the list without them would silently clear them.
import { request, ServerError } from "./api.js";
import { AAD, DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { readFileList, recordWrittenList } from "./manifest.js";
import { encodeManifest } from "./shared/lib/drive/manifest-codec.js";
import { buildIndex, entryAt, isLive, KIND_FILE, namesIn, normaliseName } from "./drive-paths.js";
import { decide } from "./collision.js";
import { applyIntents, applySettingsPatch, } from "./shared/lib/drive/manifest-ops.js";
import { uniqueFileName } from "./shared/lib/drive/unique-name.js";
/** How many times a lost compare-and-swap is re-applied before giving up. */
const CONFLICT_RETRIES = 3;
/**
 * Apply one intent to the account's sealed file list.
 *
 * ⛔ THE INTENT IS WHAT IS RETRIED, NEVER FINISHED BYTES. On a lost compare-and-swap the list is
 *    read again and the intent is applied to the NEW one, so both edits survive. That is why the
 *    caller passes a function rather than an intent: an intent computed once against the old list
 *    could name a folder id, or a free name, that the new list no longer has.
 *
 * ⛔ AND THE INTENTS COME FROM THE BROWSER'S OWN MODULE, copied here byte-for-byte by
 *    `deploy/gen-cli-shared.mjs`. Re-implementing "send to the trash" would look trivial and be
 *    wrong in the small places: a re-trashed item must keep its ORIGINAL instant (it is the start
 *    of the 30-day window the product promises), and trashing a folder must not stamp its
 *    children (that would reset each child's own clock).
 *
 * `make` returning null means there is nothing to do; nothing is written and `changed` is false.
 */
export async function applyToList(input, make) {
    // ⛔ ONE COMPARE-AND-SWAP LOOP IN THIS FILE, and this is the one-intent door into it. A second
    //    copy would be a second place for "decide again on every attempt" to be got right, and the
    //    copy nobody re-reads is the one that quietly re-applies a stale decision.
    return applyManyToList(input, (entries) => {
        const intent = make(entries);
        return intent === null ? [] : [intent];
    });
}
/**
 * Apply a RUN of intents to the account's sealed file list — as ONE write.
 *
 * ⛔ ONE WRITE, NOT ONE PER TARGET. A command naming five things and writing five times is five
 *    chances to lose the compare-and-swap, and losing it half way leaves a drive nobody asked
 *    for: three things moved, two not, and one error that names neither half. The whole list is
 *    rewritten on every save anyway (see the header), so five edits cost exactly what one costs.
 *
 * ⛔ AND `make` DECIDES THE WHOLE RUN AGAIN ON EVERY ATTEMPT. A free name, an existing folder and
 *    a live target are all facts about the version that was READ, and a retry happens against a
 *    version somebody else has just written. A `make` that folds its own intents onto a working
 *    copy as it goes must start that fold from the list it is handed each time — never from the
 *    working copy it built on the attempt before.
 *
 * An empty run means there is nothing to do; nothing is written and `changed` is false.
 *
 * ⛔ AND THE ACCOUNT'S SETTINGS RIDE IN THE SAME WRITE. They live in this blob or nowhere (see the
 *    header), so a caller that wanted to change one and did it in a second write would spend two
 *    version bumps and two chances to lose the compare-and-swap on one edit. `patch` is DESIRED
 *    STATE per field, like every intent above, so replaying it after a lost swap lands the same
 *    answer. Absent means "carry the settings forward untouched", which is what every caller but
 *    one wants.
 */
export async function applyManyToList(input, make, patch) {
    const crypt = await loadCrypto();
    const [from, to] = DERIVED.fileListKey;
    const derived = crypt.kdf_derive(crypt.account_code_parse(input.code));
    const key = derived.slice(from, to);
    derived.fill(0);
    try {
        let conflicted = false;
        for (let attempt = 0; attempt <= CONFLICT_RETRIES; attempt += 1) {
            const current = await readFileList(input.server, input.apiKey, input.code, input.accountId);
            const entries = current.manifest ? current.manifest.entries : [];
            // ⛔ THE SAME REFERENCE COMES BACK WHEN NOTHING CHANGED, which is what the no-op test below
            //    reads. `applySettingsPatch` promises that, and the empty object stands in for an
            //    account that has never written a setting so that the comparison has something to hold.
            const held = current.manifest?.settings ?? {};
            const settings = patch === undefined ? held : applySettingsPatch(held, patch);
            const intents = make(entries);
            const next = intents.length === 0 ? entries : applyIntents(entries, intents);
            // ⛔ A no-op is a SUCCESS, not a failure. Renaming a file to the name it already has, or
            //    trashing something already in the trash, must not cost a version bump every other
            //    device then has to download.
            if (next === entries && settings === held) {
                return { seq: current.seq ?? 0, reappliedAfterConflict: conflicted, changed: false, entries };
            }
            const body = await encodeManifest(next, (current.seq ?? 0) + 1, current.fingerprint, settings);
            const sealed = crypt.envelope_seal(key, new TextEncoder().encode(AAD.fileList), body);
            body.fill(0);
            const ct = Buffer.from(sealed).toString("base64url");
            try {
                const answer = await request(input.server, "/v1/manifest", {
                    method: "PUT",
                    token: input.apiKey,
                    body: { base_seq: current.seq ?? null, ct },
                });
                const seq = seqOf(answer);
                await recordWrittenList(input.accountId, seq, ct);
                return { seq, reappliedAfterConflict: conflicted, changed: true, entries: next };
            }
            catch (error) {
                // ⛔ A version conflict is an ORDINARY outcome, not a failure: another device wrote first.
                //    Anything else is not, and must not be retried into a second attempt at the same edit.
                if (!(error instanceof ServerError) || error.code !== "VERSION_CONFLICT")
                    throw error;
                conflicted = true;
            }
        }
        throw new NmtsError(`The file list was rewritten by something else ${CONFLICT_RETRIES + 1} times in a row.`, {
            nextStep: "Nothing about this edit was lost — running the same command again applies it to the " +
                "list as it now stands.",
        });
    }
    finally {
        key.fill(0);
    }
}
/**
 * The entries a run of typed paths names, in the order they were typed.
 *
 * ⛔ HERE, BESIDE THE BATCH WRITE, so every command that takes many paths answers "the same thing
 *    named twice" the same way: once. `nmts rm a.txt a.txt` is not two deletions, and a repeated
 *    id inside one intent would make the count in the message disagree with the list written.
 *
 * ⛔ AND A PATH THAT DOES NOT RESOLVE REFUSES THE WHOLE RUN, because it throws from here before
 *    anything is composed. That is the decision every batch command in this tool makes: nothing
 *    is half-done. Moving the four paths that resolved and skipping the fifth would exit 0 on a
 *    command that did not do what it was told, and the caller would have to diff the drive to
 *    find out which one. A path already IN the state being asked for is not this case — that is
 *    a no-op, and each command names it in its own words.
 *
 * ⚠ Call it INSIDE `make`. A path is a question about the list, and the answer changes when
 *   another device writes first.
 */
export function batchTargets(entries, paths, options = {}) {
    const out = [];
    const seen = new Set();
    for (const path of paths) {
        const found = entryAt(entries, path, options);
        if (seen.has(found.id))
            continue;
        seen.add(found.id);
        out.push(found);
    }
    return out;
}
/**
 * Decide what adding this entry does — the whole of the collision rule, with no server in it.
 *
 * ⛔ IT IS RE-RUN ON EVERY COMPARE-AND-SWAP ATTEMPT, so everything it looks at has to come from
 *    the `entries` it is handed. A free name, a live holder and a folder id are all facts about
 *    the version that was READ, and a retry happens against a version somebody else just wrote.
 *
 * ⛔ ONLY A LIVE FILE IS DISPLACED. A folder can hold the name, and replacing one would mean
 *    deleting it and everything under it in order to store a single file. A trashed file holds its
 *    name too, and displacing THAT would destroy something already on its way out for a name the
 *    person can no longer see. Both are renamed around, with no answer consulted — which is what
 *    happened to every collision before anything could be answered at all.
 */
export function planAddition(entries, entry, 
/**
 * The ANSWER, already settled — not what a run asked for.
 *
 * ⛔ WHO IS ALLOWED TO SAY "OVERWRITE" IS `collision.ts`'s JOB, not this one's. It weighs the
 *    machine's stored answer, what the run asked for, and whether a mode lets an agent decide
 *    for itself. Re-deriving any of that here would be a second place for the owner's rule to
 *    live, and the copy nobody re-reads is the one that quietly disagrees.
 */
choice, now = Date.now()) {
    // ⛔ An id already in the list is not added twice: the account would show two rows for one file
    //    and the second would be unreachable. It is also how a re-run of an interrupted upload finds
    //    its own work already done.
    const existing = entries.find((e) => e.id === entry.id);
    if (existing !== undefined)
        return { name: existing.name, alreadyThere: existing.name, intents: [] };
    const folded = normaliseName(entry.name);
    const index = buildIndex(entries);
    const holder = entries.find((e) => e.parentId === entry.parentId &&
        e.kind === KIND_FILE &&
        normaliseName(e.name) === folded &&
        isLive(index, e));
    if (holder !== undefined && choice === "overwrite") {
        return {
            name: entry.name,
            replaced: { id: holder.id, name: holder.name },
            intents: [
                { op: "trash", ids: [holder.id], at: now },
                { op: "add", entry },
            ],
        };
    }
    const name = uniqueFileName(entry.name, namesIn(entries, entry.parentId));
    return { name, intents: [{ op: "add", entry: { ...entry, name } }] };
}
/**
 * Add one entry to the account's sealed file list.
 *
 * ⛔ THE NAME IS CHOSEN AGAINST THE LIST AS IT IS ON THIS ATTEMPT. That is the reason this passes
 *    a function to `applyManyToList`: after a lost compare-and-swap the free names have changed,
 *    and a name picked against the old list could land on top of what the other device just added.
 *    The collision is judged again on every attempt for the same reason.
 *
 * ⛔ ONLY A LIVE FILE IS DISPLACED. A folder can hold the name, and replacing one would mean
 *    deleting it and everything under it in order to store a single file. Those are renamed, with
 *    no answer consulted, exactly as every collision was before anything could be answered at all.
 */
export async function addEntry(input) {
    let name = input.entry.name;
    let alreadyThere = null;
    let replaced;
    // ⛔ SETTLED ONCE, OUTSIDE THE RETRY LOOP. What the machine is set to and whether a mode is on
    //    are facts about this run, not about the list version a compare-and-swap happened to read.
    const choice = decide(input.onCollision).choice;
    const result = await applyManyToList(input, (entries) => {
        const plan = planAddition(entries, input.entry, choice);
        alreadyThere = plan.alreadyThere ?? null;
        name = plan.name;
        replaced = plan.replaced;
        return plan.intents;
    });
    return {
        seq: result.seq,
        name: alreadyThere ?? name,
        reappliedAfterConflict: result.reappliedAfterConflict,
        ...(replaced ? { replaced } : {}),
    };
}
function seqOf(answer) {
    if (typeof answer === "object" && answer !== null) {
        const seq = Reflect.get(answer, "seq");
        if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1)
            return seq;
    }
    throw new NmtsError("The file list was written but the server did not say which version it is now.", {
        nextStep: "The entry is saved. Run `nmts ls` to see it.",
    });
}

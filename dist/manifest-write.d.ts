import { type ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";
import { type FindOptions } from "./drive-paths.ts";
import { type OnCollision } from "./collision.ts";
import { type ManifestIntent, type SettingsPatch } from "./shared/lib/drive/manifest-ops.ts";
/**
 * ⛔ THE SAME FIELD NAMES `Session` USES, so a session IS a valid input and nothing has to be
 *    translated between the two. One thing with two names is how a caller ends up passing the
 *    server where the account id goes on the day a field moves.
 */
export interface ListEditInput {
    server: string;
    apiKey: string;
    code: string;
    accountId: string;
}
export interface ListEditResult {
    /** The version now current. */
    seq: number;
    /** True when the list was rebuilt because another device wrote first. */
    reappliedAfterConflict: boolean;
    /** False when the intent was already true of the list, so nothing was written. */
    changed: boolean;
    /** The list as it now stands — after the edit, or as found when nothing changed. */
    entries: readonly ManifestEntry[];
}
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
export declare function applyToList(input: ListEditInput, make: (entries: readonly ManifestEntry[]) => ManifestIntent | null): Promise<ListEditResult>;
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
export declare function applyManyToList(input: ListEditInput, make: (entries: readonly ManifestEntry[]) => readonly ManifestIntent[], patch?: SettingsPatch): Promise<ListEditResult>;
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
export declare function batchTargets(entries: readonly ManifestEntry[], paths: readonly string[], options?: FindOptions): ManifestEntry[];
export interface AddEntryInput extends ListEditInput {
    /** The entry to add. Its `name` may be changed to avoid a collision — see the result. */
    entry: ManifestEntry;
    /**
     * What THIS run asked for when the name is already in use. Absent = whatever this machine is
     * set to (`collision.ts`), which is what an ordinary upload wants.
     */
    onCollision?: OnCollision;
}
export interface AddEntryResult {
    /** The version now current. */
    seq: number;
    /** The name the entry actually got, which is not the requested one if that was taken. */
    name: string;
    /** True when the list was rebuilt because another device wrote first. */
    reappliedAfterConflict: boolean;
    /**
     * The file this one displaced, when the name was taken and the answer was to overwrite.
     *
     * ⛔ IT IS IN THE TRASH, NOT GONE. This tool cannot destroy a stored row: the endpoint that does
     *    is closed to an API key on purpose (`item-trash.ts`). So the caller's remaining job is to
     *    tell the SERVER to trash it too — and what the tool prints must say "trash", never "gone".
     */
    replaced?: {
        id: string;
        name: string;
    };
}
/** What one addition turns into, worked out against the list as it stands on THIS attempt. */
export interface AdditionPlan {
    /** The name it will be stored under. */
    name: string;
    /** Set when this id is ALREADY in the list — then `intents` is empty and nothing is written. */
    alreadyThere?: string;
    /** The live file this displaces, when the name was taken and the answer was to overwrite. */
    replaced?: {
        id: string;
        name: string;
    };
    intents: ManifestIntent[];
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
export declare function planAddition(entries: readonly ManifestEntry[], entry: ManifestEntry, 
/**
 * The ANSWER, already settled — not what a run asked for.
 *
 * ⛔ WHO IS ALLOWED TO SAY "OVERWRITE" IS `collision.ts`'s JOB, not this one's. It weighs the
 *    machine's stored answer, what the run asked for, and whether a mode lets an agent decide
 *    for itself. Re-deriving any of that here would be a second place for the owner's rule to
 *    live, and the copy nobody re-reads is the one that quietly disagrees.
 */
choice: OnCollision, now?: number): AdditionPlan;
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
export declare function addEntry(input: AddEntryInput): Promise<AddEntryResult>;

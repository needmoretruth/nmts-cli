// `nmts sweep` — dropping the entries whose thirty days in the trash have run out.
//
// ⛔ IT IS THE ONLY THING THIS TOOL DOES THAT CANNOT BE UNDONE, and that is why it is a command
//    somebody types rather than something that happens. A browser runs this sweep at every sign-in,
//    which is safe there because a person is standing in front of it and can see the drive. Here
//    the caller is often a program in a loop on a machine whose clock nobody has checked, and the
//    rule the sweep runs on is "thirty days by this machine's clock". A date set a year forward
//    would empty the whole trash — and if the sweep were attached to `ls`, it would do it without
//    any command about deletion ever having been typed.
//
// ⛔ SO IT STOPS, AND `--yes` IS WHAT ANSWERS. Not one of the once-per-machine agreements in
//    `consent.ts`: those are the right shape for a capability (this account may spend, this machine
//    may hold the code unsealed) and the wrong shape for an act. Granted once, a `sweep` key would
//    make every future sweep silent, which is no better than the automatic version it was meant to
//    replace. What has to be decided is not "may this tool ever sweep" but "may it drop THESE
//    entries, today, on this clock" — so the answer is per run, and the run that is refused prints
//    exactly what it would have dropped.
//
// ⛔ THE SERVER GOES FIRST, AND HERE THAT MEANS WAITING FOR IT RATHER THAN CALLING IT. The endpoint
//    that erases a row for good refuses an API key on purpose — reversible is reachable, permanent
//    is not — so this side cannot do the server's half and must not pretend the order does not
//    matter. It asks what the server still holds, and anything still there stays in the list.
//
// ⛔ AND IT DROPS WHOLE BRANCHES. See `trash-sweep.ts`: a folder dropped while a file under it is
//    kept leaves that file with no trashed ancestor, which reads as LIVE for ever after.
import { request } from "../api.js";
import { buildIndex, fullPathOf, trashedAt } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { applyToList } from "../manifest-write.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { expiredTrashEntries, filesAmong, planPurge, TRASH_RETENTION_DAYS, } from "../trash-sweep.js";
const DAY_MS = 86_400_000;
/**
 * How many pages of the server's item listing one sweep will read.
 *
 * ⛔ THERE IS A CEILING BECAUSE "ABSENT FROM A PARTIAL LISTING" IS NOT "ERASED". The whole
 *    safeguard below rests on having seen every row the server still holds, so a listing that ran
 *    out of patience must stop the sweep rather than shorten it. A hundred rows a page puts the
 *    limit well past any drive a command-line tool is the right way to manage.
 */
const MAX_PAGES = 200;
export async function sweep(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const now = options.now ?? Date.now();
    const session = await openSession(options);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    const entries = list.manifest?.entries ?? [];
    const index = buildIndex(entries);
    const expired = expiredTrashEntries(index, now);
    if (expired.length === 0) {
        // ⚠ The server is not asked at all in this case. It is the ordinary one, it costs a round trip,
        //   and there is nothing its answer could change.
        if (options.json) {
            // The same keys the other paths print, so a caller never has to branch on which one ran.
            say(JSON.stringify({
                expired: 0,
                readyToDrop: 0,
                dropped: 0,
                waitingOnServer: 0,
                heldWholeBranch: 0,
                changed: false,
                entries: [],
            }));
            return 0;
        }
        say(`Nothing in the trash has passed its ${TRASH_RETENTION_DAYS} days.`);
        return 0;
    }
    const held = await serverItemIds(session.server, session.apiKey);
    if (!held.complete) {
        throw new NmtsError(`This account has more stored files than one sweep will read.`, {
            exitCode: 4,
            nextStep: `Nothing was changed. Dropping an entry is only safe once the server has been seen to let ` +
                `go of its own copy of the key, and a listing that stopped early cannot show that. The ` +
                `browser sweeps the same entries at sign-in.`,
        });
    }
    const plan = planPurge(index, expired, held.ids);
    const shown = (e) => fullPathOf(index, e);
    const ageDays = (e) => Math.floor((now - (trashedAt(index, e) ?? now)) / DAY_MS);
    // ⛔ THE MACHINE-READABLE ANSWER IS PRINTED ONCE, ON WHICHEVER PATH THE RUN TAKES. Printing it up
    //    front and then carrying on would put two JSON objects on one stream, and a caller reading
    //    the first would be told `changed: false` about a run that went on to change the list.
    const summary = (dropped, changed, extra = {}) => JSON.stringify({
        expired: expired.length,
        readyToDrop: plan.drop.length,
        dropped,
        waitingOnServer: plan.waiting.length,
        heldWholeBranch: plan.tangled.length,
        changed,
        ...extra,
        entries: describe(plan, shown, ageDays),
    });
    if (plan.drop.length === 0) {
        if (options.json)
            say(summary(0, false));
        else
            reportHeldBack(say, plan);
        return 0;
    }
    if (options.yes !== true) {
        if (options.json) {
            say(summary(0, false));
            return 5;
        }
        const files = filesAmong(plan.drop);
        say(`${plan.drop.length} thing${plan.drop.length === 1 ? "" : "s"} in the trash passed ` +
            `${TRASH_RETENTION_DAYS} days and can be dropped from the file list (${files} of them ` +
            `${files === 1 ? "is a file" : "are files"}).`);
        say(``);
        const width = Math.max(...plan.drop.map((e) => shown(e).length));
        for (const entry of plan.drop)
            say(`  ${shown(entry).padEnd(width)}  trashed ${ageDays(entry)} days ago`);
        say(``);
        say(`⛔ This cannot be undone. Dropping an entry destroys this account's only remaining copy of`);
        say(`   the key that opens that file — the server has already destroyed its own — so nothing`);
        say(`   anywhere will open those bytes again. The bytes themselves stay on the storage network`);
        say(`   until the term already paid for runs out; no refund follows from this.`);
        say(``);
        reportHeldBack(say, plan);
        say(`Nothing was changed. To go ahead:  ${BINARY_NAME} sweep --yes`);
        say(`⛔ If a program is reading this on somebody's behalf: show it to them and let them decide.`);
        return 5;
    }
    // ⛔ RE-DECIDED AGAINST THE LIST AS IT IS ON THIS ATTEMPT, and never wider than what was planned.
    //    A lost compare-and-swap means another device wrote in between, and it may have restored one
    //    of these — replaying a fixed set of ids would then purge something that is out of the trash.
    //    The intersection with `promised` is the other half: a run may do less than it announced, and
    //    may never do more.
    const promised = new Set(plan.drop.map((e) => e.id));
    let dropped = 0;
    const result = await applyToList(session, (current) => {
        const fresh = buildIndex(current);
        const again = planPurge(fresh, expiredTrashEntries(fresh, now), held.ids);
        const ids = again.drop.map((e) => e.id).filter((id) => promised.has(id));
        dropped = ids.length;
        return ids.length === 0 ? null : { op: "purge", ids };
    });
    if (options.json) {
        say(summary(dropped, result.changed, { reappliedAfterConflict: result.reappliedAfterConflict, seq: result.seq }));
        return 0;
    }
    say(dropped === 0
        ? `Nothing was dropped: the file list changed while this ran and none of them is still due.`
        : `Dropped ${dropped} entr${dropped === 1 ? "y" : "ies"} from the file list.`);
    if (result.reappliedAfterConflict) {
        say(`  Another device wrote the file list first, so this was applied to that version.`);
    }
    reportHeldBack(say, plan);
    return 0;
}
/** The entries this run deliberately left alone, each with the reason it was left. */
function reportHeldBack(say, plan) {
    if (plan.waiting.length > 0) {
        say(`${plan.waiting.length} more ${plan.waiting.length === 1 ? "is" : "are"} past ` +
            `${TRASH_RETENTION_DAYS} days and stayed: the server still holds their rows, so the key it ` +
            `keeps is still there. It sweeps its own side on a timer — running this again later finishes them.`);
    }
    if (plan.tangled.length > 0) {
        say(`${plan.tangled.length} folder${plan.tangled.length === 1 ? "" : "s"} above ` +
            `${plan.tangled.length === 1 ? "one of them" : "those"} stayed too. Dropping a folder while ` +
            `something under it remains would leave that thing with nothing marking it as trash, and it ` +
            `would read as a live file this tool can never fetch.`);
    }
}
/** One row per expired entry, saying what happened to it. For the machine-readable answer. */
function describe(plan, shown, ageDays) {
    const rows = [];
    for (const [action, group] of [
        ["drop", plan.drop],
        ["waiting", plan.waiting],
        ["tangled", plan.tangled],
    ]) {
        for (const entry of group) {
            rows.push({ id: entry.id, path: shown(entry), daysInTrash: ageDays(entry), action });
        }
    }
    return rows;
}
/**
 * Every item id the server still holds a row for, live or trashed.
 *
 * ⛔ `/v1/objects` AND NOT `/v1/items?deleted=true`. The trash listing stops at the retention
 *    window, so a row that is past thirty days and not yet erased is missing from it — and
 *    "missing" is exactly the answer this function must not get wrong. `/v1/objects` is the
 *    reconciliation view: every row of the account, with no window on it.
 *
 * ⚠ The two calls are written out rather than built from a variable so that the gate comparing
 *   this tool's addresses against the server's routes can see them both. It reads literal strings.
 */
async function serverItemIds(base, apiKey) {
    const ids = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = cursor === null
            ? await request(base, "/v1/objects", { token: apiKey })
            : await request(base, `/v1/objects?after=${encodeURIComponent(cursor)}`, { token: apiKey });
        const read = asObjectsAnswer(answer);
        for (const id of read.ids)
            ids.add(id);
        if (read.next === null)
            return { ids, complete: true };
        cursor = read.next;
    }
    return { ids, complete: false };
}
/**
 * What `GET /v1/objects` answers, narrowed rather than trusted.
 *
 * ⛔ A ROW THIS CANNOT READ IS A REFUSAL. Skipping one would shrink the set of things the server is
 *    known to hold, and every id missing from that set is an entry this command then drops.
 */
function asObjectsAnswer(value) {
    const unreadable = () => {
        throw new NmtsError("The server answered with an item listing this version cannot read.", {
            nextStep: "Nothing was changed. Update this tool before sweeping.",
        });
    };
    if (typeof value !== "object" || value === null)
        return unreadable();
    const raw = Reflect.get(value, "objects");
    if (!Array.isArray(raw))
        return unreadable();
    const objects = raw;
    const ids = [];
    for (const object of objects) {
        if (typeof object !== "object" || object === null)
            return unreadable();
        const id = Reflect.get(object, "id");
        if (typeof id !== "string")
            return unreadable();
        ids.push(id);
    }
    const next = Reflect.get(value, "next_cursor");
    if (next !== null && next !== undefined && typeof next !== "string")
        return unreadable();
    return { ids, next: typeof next === "string" && next !== "" ? next : null };
}

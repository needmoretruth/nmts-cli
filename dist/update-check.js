// Noticing that a newer `nmts` has been published, without getting in the way of the command.
//
// ⛔ WHY IT IS NOT A REQUEST PER RUN. An agent runs this tool in a loop; a network round trip
//    added to every invocation is paid thousands of times, and paid to a host that has nothing to
//    do with the command being run. So the answer is written down and re-read, and a fresh one is
//    asked for at most once a day.
//
// ⛔ WHY THE NOTICE IS ONE RUN BEHIND. What this run prints comes from the file; what it looks up
//    goes into the file for the next run. The alternative is making every command wait on a host
//    that may be slow or unreachable before it can print its own answer, which trades the thing
//    somebody asked for against a thing they did not.
//
// ⛔ STDERR, ALWAYS. The answer to `nmts ls --json` is on stdout and something is parsing it. A
//    version notice is not part of any command's answer.
//
// ⛔ IT NEVER THROWS AND NEVER CHANGES AN EXIT CODE. A version check that can fail a command is a
//    version check that eventually breaks somebody's script for a reason unrelated to what they
//    asked for. ⚠ That is a swallowed failure, which this repository generally treats as a defect
//    — so it is not swallowed silently: the reason is written into the file and `nmts env` prints
//    it. Quiet where it is implicit, loud where it was asked for, and never invisible.
//
// ⛔ AND IT CAN BE TURNED OFF. This is the only thing in the tool that talks to a host other than
//    the NMTS server and the storage network, so it says so in `nmts env` and in the help, and one
//    environment variable stops it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
import { isRecord } from "./guards.js";
import { BINARY_NAME } from "./product.js";
import { checkingIsOff, isNewer, isVersion, LATEST_RELEASE_URL, newerVersionLine, versionFromLocation, } from "./update-source.js";
// ⛔ The switch lives in `update-source.ts` and is re-exported rather than re-declared: the help
//    text needs its name, and importing this module to get it would make `nmts --help` load the
//    file machinery to print one line.
export { checkingIsOff, NO_CHECK_ENV_VAR } from "./update-source.js";
/** How long an answer is kept before another is asked for. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * How long one lookup may take.
 *
 * ⚠ Short on purpose. This runs after a command has already done its work, so every millisecond
 *   here is a millisecond somebody waits for a process that has nothing left to say. A host that
 *   cannot answer in this long is treated as not having answered, and asked again tomorrow.
 */
const LOOKUP_TIMEOUT_MS = 2_000;
export function checkPath() {
    return join(configDir(), "update-check.json");
}
/** What is on disk, or null when there is nothing readable there. */
export function readCheck() {
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(checkPath(), "utf8"));
    }
    catch {
        // ⛔ Unreadable counts as "never checked", which asks again. The other direction would let a
        //    corrupt file switch the check off for good.
        return null;
    }
    if (!isRecord(parsed))
        return null;
    const checkedAt = parsed["checkedAt"];
    if (typeof checkedAt !== "string" || Number.isNaN(Date.parse(checkedAt)))
        return null;
    const record = { checkedAt };
    const latest = parsed["latest"];
    // ⛔ The version is shape-checked coming OUT of the file as well as going in. This file sits in
    //    a directory anything running as you can write, and what it holds ends up in a printed line.
    if (typeof latest === "string" && isVersion(latest))
        record.latest = latest;
    const failed = parsed["failed"];
    if (typeof failed === "string" && failed.length > 0)
        record.failed = failed.slice(0, 200);
    return record;
}
/** Write the attempt down. Failing to write is itself ignored: there is nothing to fall back to. */
export function writeCheck(record) {
    try {
        mkdirSync(configDir(), { recursive: true, mode: 0o700 });
        writeFileSync(checkPath(), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    }
    catch {
        // Nothing to do about it and nothing worth failing a command over. The next run simply asks
        // again, which is the same behaviour as never having checked.
    }
}
/** Is it time to ask again? Never having asked counts as due. */
export function dueForCheck(record, nowMs) {
    if (record === null)
        return true;
    const last = Date.parse(record.checkedAt);
    if (Number.isNaN(last))
        return true;
    // A file stamped in the future is a clock that moved, not a check from tomorrow.
    return nowMs - last >= CHECK_EVERY_MS || last > nowMs;
}
/**
 * Ask which release is newest.
 *
 * ⛔ THE REDIRECT IS THE ANSWER, so it is not followed. `releases/latest` replies with the address
 *    of the tagged page and an empty body; following it would download a page this has no use for.
 */
export async function lookupLatest(url = LATEST_RELEASE_URL) {
    let response;
    try {
        response = await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        });
    }
    catch (error) {
        return { failed: error instanceof Error ? error.message : "no answer" };
    }
    // The body of a redirect is not part of the answer; reading it releases the connection.
    await response.arrayBuffer().catch(() => undefined);
    if (response.status < 300 || response.status >= 400) {
        return { failed: `the releases page answered ${response.status}` };
    }
    const location = response.headers.get("location");
    if (location === null || location === "")
        return { failed: "the releases page redirected to nowhere" };
    const version = versionFromLocation(location);
    if (version === null)
        return { failed: "the newest release is not named in a shape this can read" };
    return { version };
}
/**
 * Print the notice this run has earned, then refresh the file for the next one.
 *
 * The order is deliberate: whatever is already known is said first, so a slow or unreachable host
 * cannot delay it, and the run that pays for the lookup is not the run that reads its result.
 */
export async function noteUpdate(options) {
    const env = options.env ?? process.env;
    if (checkingIsOff(env))
        return;
    const say = options.say ?? ((line) => process.stderr.write(`${line}\n`));
    const now = options.now ?? new Date();
    try {
        const record = readCheck();
        if (record?.latest !== undefined && isNewer(record.latest, options.running)) {
            say(newerVersionLine(record.latest, options.running, BINARY_NAME));
        }
        if (!dueForCheck(record, now.getTime()))
            return;
        const lookup = options.lookup ?? (() => lookupLatest());
        const result = await lookup();
        const written = { checkedAt: now.toISOString() };
        if ("version" in result)
            written.latest = result.version;
        else {
            // ⛔ A FAILED ATTEMPT STILL COUNTS AS AN ATTEMPT. Without the stamp, a machine that cannot
            //    reach the host would try again on every single command — turning an unreachable host
            //    into a request storm and a delay on every run.
            written.failed = result.failed;
            if (record?.latest !== undefined)
                written.latest = record.latest;
        }
        writeCheck(written);
    }
    catch {
        // Nothing a version check discovers is worth failing somebody's command over. The reason is
        // in the file above where it can be read; there is nowhere else for it to go from here.
    }
}

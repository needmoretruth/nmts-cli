// How much this machine's owner has said an agent may decide on its own.
//
// ⛔ THIS IS A DIFFERENT AXIS FROM CONSENT, and mixing the two would make both harder to reason
//    about. A consent key says "this machine agreed that this tool may do X" -- it is about the
//    CAPABILITY, it is recorded, and it stands until it is revoked. A mode says "an agent driving
//    this tool may decide for me" -- it is about WHO CHOOSES, and it changes nothing about what
//    the tool is able to do. They are stored in different files for that reason: a mode is not a
//    sixth consent, and the count of consents is a number this package deliberately holds down.
//
// ⛔ NOTHING IS ON BY DEFAULT, AND TURNING ONE ON TAKES A FLAG THAT SAYS SO. The person is the one
//    who bears what an unattended agent does with their files and their money, so the sentence
//    that turns it on has to be one nobody types by accident.
//
// ⛔ WHAT A MODE DOES NOT DO: it does not grant a consent, and it cannot grant itself. Every
//    capability that costs money or cannot be undone is still recorded as its own agreement. What
//    `skip-permissions` changes is WHO MAY RECORD IT -- with it on, an agent may run the grant
//    command, which without it the instructions forbid. The record still says what was agreed and
//    when, so a person reading it afterwards sees the same thing either way.
//
// ⚠ AND WHAT NO COMMAND-LINE TOOL CAN DO: tell whether a person or a program typed this. The
//   protection here is that the choice is explicit, written down, dated, and announced on every
//   run that uses it -- not that it cannot be automated.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { configDir, modesAreEnforced } from "./credentials.js";
export const AUTONOMY_MODES = ["off", "auto", "skip-permissions"];
/** What each mode means, in the words the tool prints. One line each, no more. */
export const MODE_MEANS = {
    off: "The agent asks you before anything that has not been agreed to. This is the default.",
    auto: "The agent decides whether you asked for it, or whether it is fine to do unasked, and goes ahead.",
    "skip-permissions": "The agent goes ahead. There is no judgement step and nothing waits for you.",
};
/** The flag that has to be typed to turn a mode on. Spelled out so nobody types it by accident. */
export const RISK_FLAG = "--i-accept-the-risk";
function path() {
    return join(configDir(), "autonomy.json");
}
function isMode(value) {
    return typeof value === "string" && AUTONOMY_MODES.includes(value);
}
/**
 * What this machine is set to.
 *
 * ⛔ Unreadable counts as `off`. The fail-safe direction for "I do not know" is the one where
 *    somebody is still asked -- a file that switches autonomy on when it cannot be parsed is worse
 *    than no file at all.
 */
export function currentMode() {
    try {
        const parsed = JSON.parse(readFileSync(path(), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return "off";
        const mode = Reflect.get(parsed, "mode");
        return isMode(mode) ? mode : "off";
    }
    catch {
        return "off";
    }
}
/** When it was set, or null when it is off or unreadable. */
export function setAt() {
    try {
        const parsed = JSON.parse(readFileSync(path(), "utf8"));
        if (typeof parsed !== "object" || parsed === null)
            return null;
        const at = Reflect.get(parsed, "setAt");
        return typeof at === "string" ? at : null;
    }
    catch {
        return null;
    }
}
/** Write the choice down, with the date and the version that was asked. */
export function setMode(mode, version, now) {
    if (mode === "off") {
        if (existsSync(path()))
            rmSync(path(), { force: true });
        return;
    }
    const body = { mode, setAt: now.toISOString(), byVersion: version };
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(path(), `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    if (modesAreEnforced())
        chmodSync(path(), 0o600);
}
/**
 * The line every run prints when a mode is on.
 *
 * ⛔ IT IS PRINTED EVERY TIME, not once. A setting that stops announcing itself is a setting people
 *    forget they turned on, and this one decides whether anybody is asked before money is spent.
 *    ⚠ It goes to stderr: stdout belongs to whatever is reading this tool's output.
 */
export function announcement(mode) {
    if (mode === "off")
        return null;
    return `${BANNER_PREFIX}${mode} — ${MODE_MEANS[mode]} Turn it off with \`nmts mode off\`.`;
}
const BANNER_PREFIX = "nmts: autonomy is ";

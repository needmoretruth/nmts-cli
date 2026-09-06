// `nmts padding` — how coarsely a file's stored size is rounded up before it is uploaded.
//
// ⛔ IT IS NOT A SETTING ABOUT ENCRYPTION. The bytes are sealed either way; what this decides is
//    how much blank space goes inside the seal, and therefore what SIZE the storage network can be
//    seen holding. A size is the one property of a stored piece that is public no matter what, so
//    the choice is between two rules for hiding it — or `off`, which hides nothing and stores the
//    file at its exact size. Walrus itself stores a blob at whatever size it is handed, so this
//    tool has to be able to as well (2026-09-06); the sentence it prints is what makes it a
//    choice rather than a trap, and no agent gets there without asking (the act is still tiered).
//
// ⛔ IT LIVES IN THE SEALED FILE LIST, NOT ON THIS MACHINE. The server must not learn it — a
//    per-account padding rule is a fingerprint a server could keep — and it follows the ACCOUNT,
//    so a phone and a laptop pad the same way. That is why reading it costs a list read and
//    setting it costs a list write, where `nmts on-collision` costs neither.
//
// ⚠ AND IT APPLIES TO WHAT IS UPLOADED NEXT. Bytes already on the storage network cannot be
//   re-padded: they were sealed at the size they were sealed at, and nothing re-uploads them. Every
//   sentence this command prints about a change says so.
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { applyManyToList } from "../manifest-write.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
/**
 * What a person types, and what the sealed list spells it as.
 *
 * ⚠ THE TWO VOCABULARIES ARE NOT THE SAME AND THAT IS DELIBERATE. The list's default rule is
 *   called Padmé inside the format (`"padme"`), which is the name of an algorithm and not
 *   something to put in front of somebody choosing a setting. On the command line the default is
 *   `standard`, and the format's own spelling never reaches the screen.
 */
const WORDS = ["standard", "pow2", "off"];
/** What each one is called in a sentence. */
const CALLED = {
    standard: "standard",
    pow2: "powers of two",
    off: "off (exact size)",
};
/** The word the sealed list spells each answer as. The two vocabularies never meet on screen. */
const SPELT = {
    standard: "padme",
    pow2: "pow2",
    off: "none",
};
function isWord(value) {
    return WORDS.includes(value);
}
export async function padding(wanted, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // ⛔ BEFORE THE NETWORK. A misspelled rule is a command line to fix, not a question to ask the
    //    server, and rounding `pow-2` down to the default would look like it worked.
    if (wanted !== undefined && wanted !== "" && !isWord(wanted)) {
        throw new NmtsError(`\`${BINARY_NAME} padding\` takes standard, pow2 or off, not "${wanted}".`, {
            exitCode: 2,
            nextStep: `Run \`${BINARY_NAME} padding\` with no argument to see which one this account uses.`,
        });
    }
    const session = await openSession({ server: options.server, network: options.network });
    if (wanted === undefined || wanted === "") {
        const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
        // ⛔ ANYTHING THIS BUILD DOES NOT KNOW IS THE DEFAULT, which is the same rule the uploader and
        //    the browser read it by. A rule this build does not know is not guessed at: padding by one
        //    nothing here can undo would give a file a size no reader can account for.
        const stored = list.manifest?.settings?.paddingMode;
        const at = stored === "pow2" ? "pow2" : stored === "none" ? "off" : "standard";
        if (options.json === true) {
            say(JSON.stringify({ padding: at }));
            return 0;
        }
        if (at === "off") {
            say(`File sizes are not hidden: a stored piece states the file's exact length.`);
            say(`Anyone can read the size of a piece stored on the storage network, and with padding off ` +
                `that size is the file's own.`);
            return 0;
        }
        say(at === "pow2"
            ? `File sizes are hidden with powers of two: a stored size shows as one value per doubling.`
            : `File sizes are hidden the standard way: a stored size shows as one of a few fixed values per doubling.`);
        say(`Anyone can read the size of a piece stored on the storage network; the blank bytes make it ` +
            `one of a set of fixed values instead of the exact number.`);
        return 0;
    }
    // ⛔ THE WRITE DECIDES WHETHER ANYTHING CHANGED, rather than a read before it. Two reads with a
    //    write between them is a race with every other device on the account; the one write already
    //    knows whether the setting it landed on was the one that was there.
    const mode = SPELT[wanted];
    // ⛔ NO LIST, NO SETTING. The mode lives inside the sealed list, and an account that has never
    //    uploaded has no list. Writing an empty one just to hold a setting would make a first `ls`
    //    say "a list exists" about an account nothing was ever put in — refuse instead, and say why.
    const before = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (before.manifest === null) {
        throw new NmtsError(`This account has no file list yet; the setting lives in the list, and there is nothing to write it into.`, { exitCode: 4, nextStep: `Upload once (\`${BINARY_NAME} put\`) and set it after.` });
    }
    const result = await applyManyToList(session, () => [], { paddingMode: mode });
    if (options.json === true) {
        say(JSON.stringify({ padding: wanted }));
        return 0;
    }
    if (!result.changed) {
        say(`Already ${CALLED[wanted]}. Nothing changed.`);
        return 0;
    }
    // ⛔ TURNING IT OFF SAYS WHAT IT COSTS, not that it was set. Nothing else here gives anything
    //    away, and a person who chose this has to be told in the same breath what is now legible —
    //    that sentence is the confirmation, which is why there is no second question (owner: safety must not shackle the person).
    if (wanted === "off") {
        say(`Uploads from now on are stored at their exact size: the file's length is visible to the ` +
            `network and to anyone who reads the blob. About 1 % less storage.`);
        return 0;
    }
    say(`Set to ${CALLED[wanted]}. It applies to what is uploaded next, from every device; files ` +
        `already uploaded keep the size they were stored at.`);
    return 0;
}

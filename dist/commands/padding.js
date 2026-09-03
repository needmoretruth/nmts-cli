// `nmts padding` — how coarsely a file's stored size is rounded up before it is uploaded.
//
// ⛔ IT IS NOT A SETTING ABOUT ENCRYPTION. The bytes are sealed either way; what this decides is
//    how much blank space goes inside the seal, and therefore what SIZE the storage network can be
//    seen holding. A size is the one property of a stored piece that is public no matter what, so
//    the choice is between two rules for hiding it and there is deliberately no "off".
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
const WORDS = ["standard", "pow2"];
/** What each one is called in a sentence. */
const CALLED = {
    standard: "standard",
    pow2: "powers of two",
};
function isWord(value) {
    return WORDS.includes(value);
}
export async function padding(wanted, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // ⛔ BEFORE THE NETWORK. A misspelled rule is a command line to fix, not a question to ask the
    //    server, and rounding `pow-2` down to the default would look like it worked.
    if (wanted !== undefined && wanted !== "" && !isWord(wanted)) {
        throw new NmtsError(`\`${BINARY_NAME} padding\` takes standard or pow2, not "${wanted}".`, {
            exitCode: 2,
            nextStep: `Run \`${BINARY_NAME} padding\` with no argument to see which one this account uses.`,
        });
    }
    const session = await openSession({ server: options.server, network: options.network });
    if (wanted === undefined || wanted === "") {
        const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
        // ⛔ ANYTHING BUT `pow2` IS THE DEFAULT, which is the same rule the uploader and the browser
        //    read it by. A rule this build does not know is not guessed at: padding by one nothing
        //    here can undo would give a file a size no reader can account for.
        const at = list.manifest?.settings?.paddingMode === "pow2" ? "pow2" : "standard";
        if (options.json === true) {
            say(JSON.stringify({ padding: at }));
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
    const mode = wanted === "pow2" ? "pow2" : "padme";
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
    say(`Set to ${CALLED[wanted]}. It applies to what is uploaded next, from every device; files ` +
        `already uploaded keep the size they were stored at.`);
    return 0;
}

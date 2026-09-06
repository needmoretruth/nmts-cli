// `nmts delete-account` — a PERSON erases this account's server record, from the terminal.
//
// ⛔ WHY IT EXISTS (2026-09-06 · CLI parity ③-3). Leaving is the one act the documents promise
//    unconditionally, and an account driven only from a terminal had no door for it but a browser:
//    the key door is shut to a bare key, and the sessionless erase door asks for a human check a
//    program cannot pass. What opens the key door is the NMTS key's proof beside the key —
//    the same proof a browser sign-in presents before its own erase button — so this command needs
//    the code on this machine, is refused in mode auto before the code is opened, and has the person
//    type the same sentence the browser asks for.
//
// ⛔ IT SAYS WHAT GOES AND WHAT STAYS, WORD FOR WORD WITH THE SERVER. Erased: the account row, the
//    file list, every file's server record and share, the sessions and the keys. Not erased: the
//    bytes on the storage network (paid through their term, and unreadable without the records),
//    and the NMTS key — which stays on this machine until `nmts logout`, because a recovery
//    list plus the code can still read what was stored. Not refunded: storage already paid for.
import { accountProofFor } from "../account-proof.js";
import { request } from "../api.js";
import { currentMode } from "../autonomy.js";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME, HOME_URL } from "../product.js";
import { promptLine, stdinIsATerminal } from "../prompt.js";
import { resolveServer } from "../server.js";
import { requireApiKey } from "../session.js";
/** The sentence the browser's erase dialog asks for — the same words, so the act is one act. */
export const CONFIRM_SENTENCE = "I UNDERSTAND THIS IS PERMANENT";
export async function deleteAccount(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    // The tier gate has already refused the auto modes and, under skip-permissions, taken a
    // --reason and the --yes. ⛔ THE SENTENCE IS STILL TYPED IN EVERY OTHER MODE: `--yes` alone does
    //    not stand for it — only the mode that turned every question off does.
    const typedFor = options.yes === true && currentMode() === "skip-permissions";
    const ask = options.readLine ?? promptLine;
    if (!typedFor && options.readLine === undefined && !stdinIsATerminal()) {
        throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
            exitCode: 3,
            nextStep: `Run this where a person can type: the erasure is confirmed by typing a sentence.`,
        });
    }
    const apiKey = requireApiKey();
    const held = await requireAccountCode();
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    say(`This erases the account's server record. It cannot be undone.`);
    say(`  Erased:       the account, the file list, every file's record and share, sessions and keys.`);
    say(`  Not erased:   the bytes on the storage network (paid through their term; unreadable without`);
    say(`                the records), and the NMTS key on this machine — \`${BINARY_NAME} logout\` removes it.`);
    say(`  Not refunded: storage already paid for. The funds went to the network, never to NMTS.`);
    say(``);
    const typed = typedFor ? CONFIRM_SENTENCE : (await ask(`Type exactly: ${CONFIRM_SENTENCE}\n> `)).trim();
    if (typed !== CONFIRM_SENTENCE) {
        say(`Nothing was erased.`);
        return 1;
    }
    // ⛔ THE PROOF IS BUILT FOR THIS ONE REQUEST AND NOTHING KEEPS IT.
    const accountProof = await accountProofFor({ code: held.code, source: held.source });
    await request(server, "/v1/account", { method: "DELETE", token: apiKey, accountProof });
    say(`Erased. The server holds nothing about this account now.`);
    say(`The stored NMTS key and API key on this machine are still here; \`${BINARY_NAME} logout\` removes them.`);
    say(`A new account can be made at any time — \`${BINARY_NAME} create\` or ${HOME_URL}.`);
    return 0;
}

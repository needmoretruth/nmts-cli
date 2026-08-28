// What signing in asks once, beyond the code itself.
//
// ⛔ ASKED AT SETUP BECAUSE THERE IS NOBODY TO ASK LATER (owner 2026-08-25: a backup program has to
//    settle at the start what to do about a name that is already in use). A question in the middle
//    of an upload is a question an unattended job never answers, and a job that waits has stopped.
//
// ⛔ IT LIVES OUTSIDE `login` SO THE ANSWER-READING IS TESTABLE AND THE COMMAND STAYS ONE THING.
//    What counts as which answer is in `collision.ts`, which a test can reach without a terminal.
//
// ⚠ Silent when nobody is there. A scripted setup gets no question and records no answer, which
//   reads as the default — rename, which destroys nothing.
import { ANSWER_NUMBER, COLLISION_MEANS, hasChosen, readAnswer, setChoice } from "./collision.js";
import { BINARY_NAME, VERSION } from "./product.js";
import { promptLine, stdinIsATerminal } from "./prompt.js";
/**
 * The one question setup asks about uploads.
 *
 * ⛔ CALL THIS OUTSIDE `holdTerminal`. Inside it the terminal is in raw mode, where a line prompt
 *    never sees a line.
 */
export async function askAboutCollisions(say) {
    if (hasChosen() || !stdinIsATerminal())
        return;
    say(``);
    say(`When a file with that name is already in the drive:`);
    say(`  ${ANSWER_NUMBER.rename}  ${COLLISION_MEANS.rename}`);
    say(`  ${ANSWER_NUMBER.overwrite}  ${COLLISION_MEANS.overwrite}`);
    const choice = readAnswer(await promptLine(`[${ANSWER_NUMBER.rename}] `));
    setChoice(choice, VERSION, new Date());
    say(`${choice} — ${COLLISION_MEANS[choice]}  Change it: ${BINARY_NAME} on-collision <rename|overwrite>`);
}

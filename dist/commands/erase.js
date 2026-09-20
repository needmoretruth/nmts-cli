// `nmts erase <paths>` — erase files for good: the server's record, and this account's key to
// them in the sealed file list. ⛔ IRREVERSIBLE, and the one act above high besides erasing the
// account.
//
// ⛔ TWO THINGS ARE DESTROYED AND THIS COMMAND ALWAYS DESTROYS THE FIRST. The server row carries
//    the wrapped key that opens the bytes; the list entry carries this account's own copy. Both
//    go here. The BYTES on the storage network are a third thing: bought by the wallet, they stay
//    until their term runs out (burning them is a signed transaction the browser makes); bought
//    with credits, `--release-storage` asks the server to destroy the treasury's storage under
//    each file first, which it does on the chain one blob at a time and reports per file.
//
// ⛔ THE ORDER, AND WHAT IT PROTECTS, ARE IN `drive-erase.ts` — the server first, the list last, a
//    failed release erasing nothing behind it. This file is the terminal over that: the sentence
//    that has to be typed, the lines a person reads, and the exit code. Nothing about what is
//    destroyed is decided twice.
//
// ⛔ THE SENTENCE IS TYPED IN EVERY MODE BUT SKIP-PERMISSIONS, where the tier gate's `--reason`
//    and `--yes` stand for it — the same rule as `delete-account`, because it is the same tier.
import { accountProofFor } from "../account-proof.js";
import { currentMode } from "../autonomy.js";
import { CONFIRM_SENTENCE } from "./delete-account.js";
import { eraseFiles, planErase } from "../drive-erase.js";
import { NmtsError } from "../errors.js";
import { BINARY_NAME } from "../product.js";
import { promptLine, stdinIsATerminal } from "../prompt.js";
import { openSession } from "../session.js";
export async function erase(paths, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (paths.length === 0) {
        throw new NmtsError(`\`${BINARY_NAME} erase\` needs the path of at least one thing in the drive.`, {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} ls --all\` prints the paths as this expects them.`,
        });
    }
    const typedFor = options.yes === true && (await currentMode()) === "skip-permissions";
    const ask = options.readLine ?? promptLine;
    if (!typedFor && options.readLine === undefined && !stdinIsATerminal()) {
        throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
            exitCode: 3,
            nextStep: `Run this where a person can type: erasing is confirmed by typing a sentence.`,
        });
    }
    const session = await openSession(options);
    const plan = await planErase(session, paths);
    const files = plan.files;
    say(`This erases ${files.length} file${files.length === 1 ? "" : "s"} for good. It cannot be undone, and not by the trash.`);
    for (const f of files)
        say(`  ${f.path}`);
    say(``);
    say(`  Erased:       the server's record of each file and this account's key to it, and its shares.`);
    if (options.releaseStorage === true) {
        say(`  Destroyed:    the storage bought with credits under each file, on the chain, before the erase.`);
        say(`                Storage bought by the wallet is not touched — it stays until its term ends.`);
    }
    else {
        say(`  Not erased:   the bytes on the storage network. They stay, unreadable, until their term ends;`);
        say(`                \`--release-storage\` also destroys the storage bought with credits under them.`);
    }
    say(`  Not refunded: storage already paid for.`);
    say(``);
    const typed = typedFor ? CONFIRM_SENTENCE : (await ask(`Type exactly: ${CONFIRM_SENTENCE}\n> `)).trim();
    if (typed !== CONFIRM_SENTENCE) {
        say(`Nothing was erased.`);
        return 1;
    }
    // ⛔ THE PROOF IS BUILT FOR THIS ONE RUN AND NOTHING KEEPS IT.
    const accountProof = await accountProofFor({ code: session.code, source: session.source });
    const outcome = await eraseFiles({ ...session, accountProof }, plan, {
        releaseStorage: options.releaseStorage === true,
    });
    const { erased, releases } = outcome;
    if (options.json) {
        say(JSON.stringify({ erased, files: outcome.files, releases, seq: outcome.seq }));
        return 0;
    }
    say(`Erased ${erased} file${erased === 1 ? "" : "s"}. Their entries are out of the file list.`);
    for (const r of releases) {
        if (r.refused !== null)
            say(`  ${r.path}: storage not released — ${r.refused}`);
        else if (r.failed > 0)
            say(`  ${r.path}: ${r.released} released, ${r.failed} could not be — those bytes are still being served.`);
        else
            say(`  ${r.path}: storage released (${r.released} destroyed${r.alreadyReleased > 0 ? `, ${r.alreadyReleased} already gone` : ""}).`);
        // ⛔ ONLY WHEN THE SERVER NAMED A NUMBER. Every release the new ledger charges costs at least
        //    one credit, so a zero here is a server that did not say rather than a release that was
        //    free — and "no credits were charged" is the wrong sentence to invent about money.
        if (r.refused === null && r.feeCredits > 0)
            say(`  ${r.path}: ${feeLine(r)}`);
    }
    return 0;
}
/** What the release cost and where it came from, in one clause. */
function feeLine(r) {
    const credits = `${r.feeCredits} credit${r.feeCredits === 1 ? "" : "s"}`;
    return r.fromDeposit
        ? `${credits} taken from that file's deposit — nothing came out of the balance`
        : `${credits} taken from the balance — that file had no deposit, so the fee is doubled`;
}

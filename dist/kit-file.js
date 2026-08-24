// The RECOVERY KIT — the one file that carries everything, account code included.
//
// ⛔⛔ IT HOLDS THE ACCOUNT CODE IN THE CLEAR, AND THAT IS THE FORMAT. It was decided deliberately
//    and against the earlier rule, by the owner, with the cost stated: whoever holds this file
//    holds the account AND the wallet, because one code derives both. The two artefacts therefore
//    mean two different things and every screen and every command must say which is which:
//      · recovery LIST — sealed. Worthless to a thief. The account code opens it.
//      · recovery KIT  — everything. One stolen file is a total loss.
//    The warning is not a formality; it is what makes the choice an honest one to offer.
//
// ⛔ THERE IS NO SPECIFICATION FOR THIS FORMAT. Its only authorities are the two programs that
//    already write and read it: `web/src/lib/auth/recovery-kit.ts` (writer) and
//    `recovery/src/kitfile.rs` (reader). The shape below was read off BOTH.
//    ⚠ WHERE THEY DIFFER: the reader requires only `format`, `version` and `account_id`, treats
//      `account_code` and `recovery_list` as optional, and reads nothing else — no
//      `generated_at`, no `account_fingerprint`, no `recovery_manifest_blob`, no `about`. The
//      writer always emits all of them. That is not a contradiction, it is the reader being
//      deliberately lenient (it sets no `deny_unknown_fields`), and it is why adding a field never
//      moved the kit version. This writer emits the writer's full set.
//
// ⛔ THE MACHINE BLOCK IS DELIMITED BY FIXED ASCII, NEVER BY THE HEADING ABOVE IT. The headings are
//    written in whatever language the person was using; a parser that looked for one would work in
//    one language and fail in another — on the day somebody is recovering, which is the only day
//    it matters.
//
// ⚠ THE HUMAN HALF IS ENGLISH ONLY, and the browser's is bilingual. The English sentences below
//   are the site's own, word for word (`RecoveryKit.*` in `web/src/messages/en.json`), so the two
//   programs do not describe one artefact differently; the Korean half lives in message bundles
//   this package does not import, and inventing a translation here would be worse than the gap.
//   `cli/src/list-file.ts` set that precedent for the sibling artefact.
import { createHash } from "node:crypto";
import { artifactAbout } from "./artifact-about.js";
import { RECOVERY_TOOL_URL } from "./recovery-release.js";
/** Start of the machine block. ⛔ Fixed bytes, never translated. */
export const KIT_DATA_BEGIN = "--- BEGIN NMTS RECOVERY KIT DATA ---";
/** End of the machine block. */
export const KIT_DATA_END = "--- END NMTS RECOVERY KIT DATA ---";
/** The marker a reader matches on before anything else is attempted. */
export const KIT_FORMAT = "nmts-recovery-kit";
/**
 * Kit version. 2 is the one that carries the recovery list; v1 carried only the code.
 *
 * ⛔ NOT RAISED FOR ANYTHING THIS TOOL ADDS. `MAX_KIT_VERSION` in the standalone program refuses a
 *    higher number outright, so a bump breaks every published build in exchange for fields those
 *    builds are happy to ignore.
 */
export const KIT_VERSION = 2;
/**
 * A short, human-checkable fingerprint of the PUBLIC account id.
 *
 * ⚠ RESTATED FROM `web/src/lib/auth/account-code.ts::accountIdFingerprint`, which this package
 *   cannot import. It has to produce the same string: a person comparing a kit written here with
 *   one written in a browser is checking two spellings of the same account.
 *
 * ⛔ IT FINGERPRINTS THE ACCOUNT ID, WHICH IS PUBLIC — never the account code and never a key. It
 *    lets somebody confirm two files refer to one account without either of them exposing a secret.
 */
export function accountIdFingerprint(accountId) {
    const hex = createHash("sha256")
        .update(accountId, "utf8")
        .digest("hex")
        .slice(0, 16)
        .toUpperCase();
    // Grouped 4 by 4 for reading aloud: "AB12-CD34-EF56-7890".
    return hex.replace(/(.{4})(?=.)/g, "$1-");
}
/** Build the kit's text: a part for a person, then a part for a program. */
export function buildRecoveryKit(input) {
    const data = {
        format: KIT_FORMAT,
        version: KIT_VERSION,
        generated_at: input.generatedAt,
        account_id: input.accountId,
        account_fingerprint: accountIdFingerprint(input.accountId),
        account_code: input.code,
        // ⛔ ALWAYS NULL HERE. That field names a copy of the list on the storage network, and this
        //    tool writes no such copy — a value would be an address nothing was ever written to.
        recovery_manifest_blob: null,
        recovery_list: input.recoveryList,
        about: artifactAbout("recovery-kit"),
    };
    const lines = [
        `# NMTS Recovery Kit`,
        `Created: ${input.generatedAt}`,
        ``,
        // ⛔ THE THEFT WARNING COMES FIRST, ABOVE THE CODE IT IS ABOUT. A caution printed underneath
        //    the thing it cautions about has already been disregarded by the time it is read.
        `⛔ Anyone who holds this file holds this account: every file in it, and the wallet that pays ` +
            `for storage. One account code opens both.`,
        `Do not keep it in a folder that syncs or backs up on its own, and do not send it to anyone. ` +
            `A drawer is often safer than a cloud folder.`,
        ``,
        `This file is the only way to recover your NMTS files. Keep it private.`,
        `This file carries your account code in the clear, your account identifier and fingerprint, ` +
            `and the whole recovery list.`,
        `Anyone with this code can open your files. If you lose it, no one — including NMTS — can ` +
            `recover them.`,
        ``,
        `Account code:`,
        `    ${input.code}`,
        ``,
        `Account identifier: ${data.account_id}`,
        `Fingerprint: ${data.account_fingerprint}`,
        `Recovery manifest blob: not yet created`,
        `Recovery list: ${input.recoveryList === null
            ? `not included — this account had no files when the kit was made`
            : `included in this file (${input.listFileCount ?? 0} files)`}`,
        ``,
        `--- HOW TO GET YOUR FILES BACK (English) ---`,
        `1. Get the recovery program from ${RECOVERY_TOOL_URL} — it runs on Linux, macOS and ` +
            `Windows, and its full source is there.`,
        `2. Open a terminal where you saved the program, and run:`,
        `       nmts-recovery --map <this file> --out <a folder to write into>`,
        `   It takes the account code and the file list out of this file, fetches your files from ` +
            `public Walrus storage, checks every piece, and writes them out.`,
        `3. To click instead of typing, run:  nmts-recovery --gui`,
        `   That opens a page only this machine can reach. The program still does the work; the page ` +
            `only shows the list and sends back what you ticked.`,
        `4. To see what your account code derives — your public code and your wallet addresses — ` +
            `run:  nmts-recovery --derive`,
        `If you would rather it opened no network connections, run it with --print-fetch-plan: it ` +
            `prints the exact addresses to fetch by hand, then restores from the folder you filled.`,
        ``,
        `--- FOR A PROGRAM ---`,
        KIT_DATA_BEGIN,
        JSON.stringify(data, null, 2),
        KIT_DATA_END,
        ``,
    ];
    // A short id slug keeps filenames distinct without printing the whole account id.
    const slug = input.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "account";
    return { filename: `nmts-recovery-kit-${slug}.txt`, content: lines.join("\n") };
}

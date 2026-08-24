// The sealed file list as a FILE somebody keeps — the same wrapper the browser hands out.
//
// ⛔ ONE FORMAT, NOT TWO. `format`, `version` and the `.nmtslist` extension are what a reader
//    matches on, and a person recovering an account may hold copies written by a browser and by
//    this command months apart. A second spelling of the same artefact would mean whoever helps
//    them has two formats to work out instead of one, at the worst possible moment. Everything in
//    the document below is therefore the browser's, byte for byte, with the two exceptions named
//    at the bottom of this comment.
//
// ⛔ NOTHING SECRET IN THE HEADER, AND THAT INCLUDES SIZES. The plaintext part of this file says
//    what the file IS — never what is inside it, not a file name, not a count, not a total. The
//    contents are one sealed envelope that opens with the account code and nothing else, so a
//    stranger who finds this learns which account it belongs to and no more.
//
// ⛔ THE ACCOUNT CODE IS NOT IN IT, and that is not an oversight to fix later. This file plus the
//    code is the account; keeping both in one place would make one theft into a total loss.
//
// ⚠ WHAT DIFFERS FROM THE BROWSER'S COPY, and neither is a format difference:
//    · The finder's note is English only. The browser ships it in English and Korean because it
//      cannot know which language the person who finds the file years later reads; this package
//      ships English strings only, and inventing a translation here would be worse than the gap.
//    · `about.app_version` names THIS PROGRAM and its version rather than the site release. It is
//      the field's own contract — a claim the writer makes about itself — and a person holding two
//      copies of one account's list can then tell which program wrote each.
import { artifactAbout, WRITTEN_BY } from "./artifact-about.js";
/** Wrapper format identifier, distinct from the recovery list's. */
export const LIST_FILE_FORMAT = "nmts-file-list";
/** The shell's version. Not the file list's own version, which is `seq`. */
export const LIST_FILE_VERSION = 1;
/** Filename extension. Deliberately not the recovery list's: the two must not be confusable. */
export const LIST_FILE_EXTENSION = "nmtslist";
// ⚠ THE HEADER BLOCK IS NOT SPELLED HERE. Three artefacts carry the same one — this file, the
//   recovery list and the recovery kit — and it is built in `artifact-about.ts` so that a renamed
//   program or a moved document reaches all three. `WRITTEN_BY` is re-exported because it is the
//   value this wrapper puts in `app_version`, and a test reads it from here.
export { WRITTEN_BY };
/** Plain-language lines for whoever finds this file with no idea what it is. */
const NOTE = [
    `This file is an encrypted copy of an NMTS (nmts.me) file list — the names, folders and file ` +
        `keys of one account, locked with its account code.`,
    `It is written by the \`nmts\` command from the copy that machine keeps. A higher number in the ` +
        `filename is a newer copy.`,
    `It does not replace the recovery list: storage-network addresses live only in the recovery ` +
        `list. Keep both, somewhere other than the account code.`,
];
/**
 * Build the document and the name to offer it under.
 *
 * Pure on purpose: it touches no disk and no clock, so what it produces can be compared against
 * the format itself rather than against whatever the machine running it happened to be doing.
 *
 * ⚠ THE VERSION IS IN THE FILENAME, ZERO-PADDED, so a folder holding several copies sorts into
 *   the order they were written and the newest is the last one.
 */
export function buildFileListFile(input) {
    const doc = {
        format: LIST_FILE_FORMAT,
        version: LIST_FILE_VERSION,
        seq: input.seq,
        ...(input.savedAt === undefined ? {} : { saved_at: input.savedAt }),
        account_id: input.accountId,
        sealed: input.sealed,
        note: [...NOTE],
        about: artifactAbout("file-list"),
    };
    const slug = input.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "account";
    return {
        filename: `nmts-file-list-${slug}-${String(input.seq).padStart(4, "0")}.${LIST_FILE_EXTENSION}`,
        content: `${JSON.stringify(doc, null, 2)}\n`,
    };
}

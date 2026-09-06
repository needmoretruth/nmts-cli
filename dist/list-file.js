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
//    contents are one sealed envelope that opens with the NMTS key and nothing else, so a
//    stranger who finds this learns which account it belongs to and no more.
//
// ⛔ THE NMTS KEY IS NOT IN IT, and that is not an oversight to fix later. This file plus the
//    code is the account; keeping both in one place would make one theft into a total loss.
//
// ⚠ WHAT DIFFERS FROM THE BROWSER'S COPY. The first two are not format differences:
//    · The finder's note is English only. The browser ships it in English and Korean because it
//      cannot know which language the person who finds the file years later reads; this package
//      ships English strings only, and inventing a translation here would be worse than the gap.
//    · `about.app_version` names THIS PROGRAM and its version rather than the site release. It is
//      the field's own contract — a claim the writer makes about itself — and a person holding two
//      copies of one account's list can then tell which program wrote each.
//    · ⛔ THE THIRD ONE IS: this command writes shell version 2 — the index plus the chunks it
//      names — for an account whose list is in chunks, and the browser does not yet. Both write
//      shell version 1 for a single-blob list, and the reader below takes either. It was done here
//      first because a copy of an index alone is a copy of nothing anybody can use, and this is
//      the command whose whole job is that the copy is complete. ▶ The browser's writer has the
//      same gap to close, and until it does, a `.nmtslist` saved from a browser on a chunked
//      account is an index with no entries behind it.
import { artifactAbout, WRITTEN_BY } from "./artifact-about.js";
/** Wrapper format identifier, distinct from the recovery list's. */
export const LIST_FILE_FORMAT = "nmts-file-list";
/**
 * The shell's version for a file holding ONE sealed blob. Not the file list's own version (`seq`).
 *
 * ⛔ A shell of version 1 means `sealed` is the whole list, and that has not changed. It is what an
 *    account still on the single-blob format produces, and every reader that ever handled this file
 *    goes on handling it.
 */
export const LIST_FILE_VERSION = 1;
/**
 * The shell's version for a file holding an INDEX and the chunks it names (NCF-3 §6.3).
 *
 * ⛔ WHY THE SHELL HAD TO MOVE TOO. At format version 2 the sealed blob the server stores is an
 *    index: it carries the settings, the version and the parent link, and NOT the entries. A copy
 *    of that blob alone is a copy of nothing anybody can use, so the chunks travel in the same
 *    file — one artefact, as before, because the whole point of this file is that the person
 *    holding it has everything.
 */
export const LIST_FILE_VERSION_CHUNKED = 2;
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
        `keys of one account, locked with its NMTS key.`,
    `It is written by the \`nmts\` command from the copy that machine keeps. A higher number in the ` +
        `filename is a newer copy.`,
    `It does not replace the recovery list: storage-network addresses live only in the recovery ` +
        `list. Keep both, somewhere other than the NMTS key.`,
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
    const chunks = input.chunks === undefined ? [] : [...input.chunks];
    const doc = {
        format: LIST_FILE_FORMAT,
        version: chunks.length > 0 ? LIST_FILE_VERSION_CHUNKED : LIST_FILE_VERSION,
        seq: input.seq,
        ...(input.savedAt === undefined ? {} : { saved_at: input.savedAt }),
        account_id: input.accountId,
        sealed: input.sealed,
        ...(chunks.length > 0 ? { chunks } : {}),
        note: [...NOTE],
        about: artifactAbout("file-list"),
    };
    const slug = input.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "account";
    return {
        filename: `nmts-file-list-${slug}-${String(input.seq).padStart(4, "0")}.${LIST_FILE_EXTENSION}`,
        content: `${JSON.stringify(doc, null, 2)}\n`,
    };
}
function stringAt(doc, name) {
    const value = doc[name];
    return typeof value === "string" && value !== "" ? value : null;
}
/**
 * Read one of these files back, accepting BOTH shells.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSING. A file missing its sealed bytes, or naming chunks that are
 *    not strings, is not a shorter list — it is a copy somebody has been keeping for years that
 *    turns out not to be one, and the moment to say so is the moment they reach for it.
 */
export function parseFileListFile(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error("that is not an NMTS file-list copy: it is not JSON");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("that is not an NMTS file-list copy: it is not an object");
    }
    const doc = { ...parsed };
    if (doc["format"] !== LIST_FILE_FORMAT) {
        throw new Error(`that is not an NMTS file-list copy: format is ${String(doc["format"])}`);
    }
    const version = doc["version"];
    if (version !== LIST_FILE_VERSION && version !== LIST_FILE_VERSION_CHUNKED) {
        // A shell this build predates. Refusing by version is the honest answer: a newer writer may
        // have put something beside `sealed` that this reader would silently drop.
        throw new Error(`this NMTS file-list copy is shell version ${String(version)}, which this build cannot read`);
    }
    const seq = doc["seq"];
    const sealed = stringAt(doc, "sealed");
    const accountId = stringAt(doc, "account_id");
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) {
        throw new Error("this NMTS file-list copy does not say which version it is");
    }
    if (sealed === null)
        throw new Error("this NMTS file-list copy carries no sealed list");
    if (accountId === null)
        throw new Error("this NMTS file-list copy does not say which account it is");
    const raw = doc["chunks"];
    if (raw !== undefined && !Array.isArray(raw)) {
        throw new Error("this NMTS file-list copy has a broken list of parts");
    }
    const chunks = [];
    for (const item of raw === undefined ? [] : raw) {
        if (typeof item !== "string" || item === "") {
            throw new Error("this NMTS file-list copy has a part that is not sealed bytes");
        }
        chunks.push(item);
    }
    if (version === LIST_FILE_VERSION_CHUNKED && chunks.length === 0) {
        throw new Error("this NMTS file-list copy says it is in parts and carries none");
    }
    return { seq, accountId, sealed, chunks };
}

// The FILE a person keeps — a self-describing wrapper around one sealed recovery list.
//
// ⛔ ONE FORMAT, NOT TWO. `format`, `version` and the `.nmtsmap` extension are what a reader
//    matches on, and somebody recovering an account may hold copies written by a browser and by
//    this command months apart. The shape below is RECOVERY-MANIFEST.md §5 and the standalone
//    program's `recovery/src/mapfile.rs` reads it; a second spelling of the same artefact would
//    mean whoever helps them has two formats to work out instead of one, at the worst moment.
//
// ⛔ WHY A WRAPPER AND NOT THE BARE ENVELOPE. On the storage network the list is the raw envelope
//    and its address says what it is. A file in somebody's Downloads folder has no such context —
//    years later it has to explain itself. `sealed` is byte-for-byte the SAME envelope a
//    storage-network copy would hold, so one reader reads either.
//
// ⛔ NOTHING SECRET IN THE HEADER, AND THAT INCLUDES SIZES. No file name, no count, no total. A
//    leaked wrapper must not say what is inside it, or even how much.
//
// ⛔ THE ACCOUNT CODE IS NOT IN IT. This file plus the code is the account; the artefact that DOES
//    carry both is the recovery kit, and it says so about itself in every language it is written.
//
// ⚠ WHAT DIFFERS FROM THE BROWSER'S COPY, and none of it is a format difference:
//    · The finder's note is English only. §5 says v2 carries both languages, and the reason is
//      sound — which language the finder reads is not something the moment of saving can know. The
//      Korean half lives in the site's message bundles, which this package does not import, and
//      `cli/src/list-file.ts` set the precedent for the sibling artefact: ship the English and say
//      so rather than invent a translation. The four English sentences below ARE the site's, word
//      for word, so the two artefacts do not describe themselves differently. ⚠ A reader never
//      reads `note` at all (`recovery/src/mapfile.rs` ignores it), so nothing refuses this file.
//    · `about.app_version` names THIS PROGRAM rather than the site release — the field's own
//      contract, and how a person holding two copies tells which program wrote each.
//    · `min_tool` is written from the table below, which is restated because it is a claim about a
//      THIRD program's versions and cannot be derived from anything here.

import { artifactAbout, type ArtifactAbout } from "./artifact-about.ts";

/** Wrapper format identifier, checked on read before anything is attempted. */
export const MAP_FILE_FORMAT = "nmts-recovery-map";

/**
 * Wrapper version — the SHELL's version, independent of the NRM version inside.
 *
 * ⛔ NOT RAISED FOR ANYTHING THIS TOOL ADDS. `MAX_WRAPPER_VERSION` in the standalone program is a
 *    CEILING: a shell numbered higher than a build knows is refused outright, unread. So a bump is
 *    a wall in front of every reader already in somebody's hands, never a courtesy.
 */
export const MAP_FILE_VERSION = 2;

/** Filename extension. Deliberately not the file-list copy's: the two must not be confusable. */
export const MAP_FILE_EXTENSION = "nmtsmap";

/**
 * The lowest `nmts-recovery` version that reads a document of a given NRM version.
 *
 * ⛔ IT SITS BESIDE `nrm` RATHER THAN REPLACING IT. `nrm` says which forms the document uses,
 *    which is the right question for any reader — ours or a stranger's re-implementation. It is
 *    the wrong question for the person holding this file during a recovery, whose actual question
 *    is "what do I need to download".
 *
 * ⚠ A CLAIM ABOUT A DIFFERENT PROGRAM, so it cannot be derived — it is measured and written down.
 *   0.1.0 was the first published build and its ceiling was NRM-2; 0.2.0 raised it and added
 *   padded parts (NRM-4). A version this table does not know is answered with the newest entry,
 *   because a form this build can write is a form the build published alongside it reads.
 *
 * ⛔ AND IT RESCUES NOBODY. Knowing you need 0.2.0 does not help if 0.2.0 does not exist, which is
 *    why the program still ships BEFORE a new form is switched on. What it buys is a refusal a
 *    person can act on, not one they can survive.
 */
const MIN_TOOL_FOR_NRM: readonly { readonly upTo: number; readonly version: string }[] = [
  { upTo: 2, version: "0.1.0" },
  { upTo: 4, version: "0.2.0" },
];

/** The version to stamp for a document declaring `nrm`. */
export function minimumToolVersion(nrm: number): string {
  const row = MIN_TOOL_FOR_NRM.find((r) => nrm <= r.upTo) ?? MIN_TOOL_FOR_NRM.at(-1);
  // The table is a literal with entries; the fallback exists so this cannot be a non-null
  // assertion, which is banned here and would be a promise about a value rather than a check.
  return row === undefined ? "0.1.0" : row.version;
}

/**
 * Plain-language lines for whoever finds this file with no other context.
 *
 * ⚠ COPIED WORD FOR WORD from the site's `mapFileNoteEn1..4`. They are product copy and this is
 *   not the place to rewrite them; if they change there, they change here.
 */
const NOTE: readonly string[] = [
  `This file is a recovery list from NMTS (nmts.me). Encrypted inside is the record of where ` +
    `this account's files are kept on the public storage network (Walrus).`,
  `It opens only with the account code this list was made for. File names and counts are not ` +
    `visible from the outside.`,
  `The original file list lives on the NMTS server. If the server can no longer be reached, this ` +
    `list together with the account code carries the information needed to find the files still ` +
    `on the storage network and open them.`,
  `A list with a higher number in its filename is newer — keep the newest. Store this file ` +
    `somewhere other than the account code. The program that reads it is at ` +
    `github.com/needmoretruth/nmts-recovery.`,
];

/** The on-disk document. */
export interface RecoveryMapFile {
  format: typeof MAP_FILE_FORMAT;
  version: typeof MAP_FILE_VERSION;
  /** NRM version of the sealed document. Read it before parsing what is inside. */
  nrm: number;
  /** Which list this is. Higher wins during a recovery. Version-independent. */
  seq: number;
  /** RFC3339 capture time, copied from inside the sealed document. */
  generated_at: string;
  /** Public account id, so a person holding several files knows which is which. */
  account_id: string;
  /** The sealed list: base64url of one NCF-3 envelope under `nmts/v3/recovery-map`. */
  sealed: string;
  min_tool: string;
  note: string[];
  about: ArtifactAbout;
}

export interface BuildMapFileInput {
  accountId: string;
  seq: number;
  generatedAt: string;
  /**
   * NRM version of the document actually sealed.
   *
   * ⛔ NOT A CONSTANT. From NRM-3 on the number a document declares depends on what is IN it, so a
   *    wrapper stating the newest version this build knows would mislabel every ordinary file —
   *    and a recovery program refuses a document claiming a version it does not know without
   *    reading a byte of it.
   */
  nrm: number;
  sealed: string;
}

/** Build the on-disk document and the filename to offer it under. */
export function buildRecoveryMapFile(input: BuildMapFileInput): {
  filename: string;
  content: string;
} {
  const doc: RecoveryMapFile = {
    format: MAP_FILE_FORMAT,
    version: MAP_FILE_VERSION,
    nrm: input.nrm,
    seq: input.seq,
    generated_at: input.generatedAt,
    account_id: input.accountId,
    sealed: input.sealed,
    min_tool: minimumToolVersion(input.nrm),
    note: [...NOTE],
    about: artifactAbout("recovery-list"),
  };
  // A short slug keeps several accounts' files apart without printing the whole id in a filename
  // that shows up in screenshots and file managers.
  const slug = input.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "account";
  // ⚠ THE SEQUENCE IS IN THE NAME AS WELL AS THE BODY, zero-padded: somebody with three of these
  //   in a folder needs to know which is newest without opening any of them.
  return {
    filename: `nmts-recovery-map-${slug}-${String(input.seq).padStart(4, "0")}.${MAP_FILE_EXTENSION}`,
    content: `${JSON.stringify(doc, null, 2)}\n`,
  };
}

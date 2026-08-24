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

import { AAD } from "./crypto.ts";
import { HOME_URL, VERSION } from "./product.ts";
import { RECOVERY_TOOL, RECOVERY_TOOL_URL } from "./recovery-release.ts";

/** Wrapper format identifier, distinct from the recovery list's. */
export const LIST_FILE_FORMAT = "nmts-file-list";
/** The shell's version. Not the file list's own version, which is `seq`. */
export const LIST_FILE_VERSION = 1;
/** Filename extension. Deliberately not the recovery list's: the two must not be confusable. */
export const LIST_FILE_EXTENSION = "nmtslist";

/** The product these artefacts come from, spelled as the format carries it. */
const PRODUCT = "NMTS";
// ⚠ The program's name and its address are NOT written here. They are the recovery release's own
//   names and they live with it (`recovery-release.ts`), because `nmts recovery` builds download
//   addresses out of the same two strings — a second copy would let a rename reach the downloader
//   and not this file's header, or the other way round.
/** Where the envelope format is written down, in the copy anybody can reach. */
const CRYPTO_SPEC_URL = `${RECOVERY_TOOL_URL}/blob/main/docs/CRYPTO-FORMAT-NCF3.md`;

/**
 * Which build wrote the file.
 *
 * ⚠ A CLAIM, NEVER A REQUIREMENT. No reader can check it, and none should refuse a file over it.
 *   It is here to save a person a search when they are holding a file and wondering what made it.
 */
export const WRITTEN_BY = `nmts-cli ${VERSION}`;

/** Plain-language lines for whoever finds this file with no idea what it is. */
const NOTE: readonly string[] = [
  `This file is an encrypted copy of an NMTS (nmts.me) file list — the names, folders and file ` +
    `keys of one account, locked with its account code.`,
  `It is written by the \`nmts\` command from the copy that machine keeps. A higher number in the ` +
    `filename is a newer copy.`,
  `It does not replace the recovery list: storage-network addresses live only in the recovery ` +
    `list. Keep both, somewhere other than the account code.`,
];

/** What the wrapper says about itself, for a program rather than a person. */
interface ArtifactAbout {
  product: string;
  product_url: string;
  app_version: string;
  artifact: string;
  tool: string;
  tool_url: string;
  spec_url: string;
  sealed: {
    format: string;
    context: string;
    encoding: string;
    opened_with: string;
    spec_url: string;
  };
}

/** The on-disk document. */
export interface FileListFile {
  format: typeof LIST_FILE_FORMAT;
  version: typeof LIST_FILE_VERSION;
  /** The list's own version number — higher is newer, the counter every device syncs by. */
  seq: number;
  /** RFC3339 — when the machine wrote its copy, on its own clock. Absent when it is not known. */
  saved_at?: string;
  /** Public account id, so a person holding several files knows which is which. */
  account_id: string;
  /** The sealed file list, base64url. Unreadable without the account code. */
  sealed: string;
  /** Plain-language lines for a finder. */
  note: string[];
  about: ArtifactAbout;
}

export interface BuildListFileInput {
  accountId: string;
  seq: number;
  /** When the copy was taken, RFC3339. Omitted when the copy does not record one. */
  savedAt?: string | undefined;
  sealed: string;
}

/**
 * Build the document and the name to offer it under.
 *
 * Pure on purpose: it touches no disk and no clock, so what it produces can be compared against
 * the format itself rather than against whatever the machine running it happened to be doing.
 *
 * ⚠ THE VERSION IS IN THE FILENAME, ZERO-PADDED, so a folder holding several copies sorts into
 *   the order they were written and the newest is the last one.
 */
export function buildFileListFile(input: BuildListFileInput): { filename: string; content: string } {
  const doc: FileListFile = {
    format: LIST_FILE_FORMAT,
    version: LIST_FILE_VERSION,
    seq: input.seq,
    ...(input.savedAt === undefined ? {} : { saved_at: input.savedAt }),
    account_id: input.accountId,
    sealed: input.sealed,
    note: [...NOTE],
    about: {
      product: PRODUCT,
      product_url: HOME_URL,
      app_version: WRITTEN_BY,
      artifact: "file-list",
      tool: RECOVERY_TOOL,
      tool_url: RECOVERY_TOOL_URL,
      spec_url: CRYPTO_SPEC_URL,
      sealed: {
        format: "ncf3",
        // The domain separator the envelope was sealed under. Not a secret and not a key: it is
        // the string a re-implementation has to pass to the same function, and one that guesses it
        // wrong gets an authentication failure with nothing to explain it.
        context: AAD.fileList,
        encoding: "base64url",
        opened_with: "nmts-account-code",
        spec_url: CRYPTO_SPEC_URL,
      },
    },
  };
  const slug = input.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "account";
  return {
    filename: `nmts-file-list-${slug}-${String(input.seq).padStart(4, "0")}.${LIST_FILE_EXTENSION}`,
    content: `${JSON.stringify(doc, null, 2)}\n`,
  };
}

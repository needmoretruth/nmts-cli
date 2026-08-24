// Reading the sealed file list: fetch it, open it, and notice when the server hands back an old one.
//
// ⛔ THE SERVER CAN LIE ABOUT THE VERSION, AND THAT IS DESIGNED FOR. The version number lives in a
//    server column AND inside the sealed blob (NCF-3 §6.1). The sealed one is authenticated; the
//    column is not. So the column is read as a hint and the sealed one is what is believed, and
//    when they disagree this module says so rather than picking one quietly.
//
// ⛔ WHAT A SINGLE READ CANNOT SEE. "Never go backwards" is only checkable against something this
//    machine already saw. A first run has nothing to compare to and is therefore trusting; every
//    run after it is not. That is why the last version and the blob's fingerprint are written down
//    — a tool that forgets cannot tell a rollback from a fresh start, and it would never say so.
//
// ⚠ THE RECORD IS NOT A SECRET. It holds an account id, a version number and a hash of ciphertext.
//    It is still written 0600, because it sits beside a file that IS a secret and one mode is
//    easier to keep right than two.
//
// ⛔ AND THE SEALED BYTES THEMSELVES ARE KEPT, beside that record. The record alone is a detector:
//    it can tell that a list went backwards, and it cannot hand anybody a list. The blob can — it
//    is the account's names, folders and file keys, sealed with the account code, and a copy of it
//    on this machine is one of the two things a person needs when the server has nothing to give
//    them. A tool that read the list on every run and then threw it away left an account used only
//    from a terminal with neither. It is written with the record, by the one function that writes
//    either, so the two can never describe different versions.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { request } from "./api.ts";
import { AAD, DERIVED, loadCrypto } from "./crypto.ts";
import { configDir } from "./credentials.ts";
import { NmtsError } from "./errors.ts";
import { decodeManifest, type Manifest } from "./shared/lib/drive/manifest-codec.ts";

/** What `GET /v1/manifest` answers. Narrowed here rather than trusted. */
type ManifestResponse =
  | { state: "absent" }
  | { state: "present"; seq: number; ct: string; updated_at: string };

function asResponse(value: unknown): ManifestResponse {
  if (typeof value !== "object" || value === null) throw new NmtsError("The server's answer was not an object.");
  const v = value as Record<string, unknown>;
  if (v["state"] === "absent") return { state: "absent" };
  if (
    v["state"] === "present" &&
    typeof v["seq"] === "number" &&
    typeof v["ct"] === "string" &&
    typeof v["updated_at"] === "string"
  ) {
    return { state: "present", seq: v["seq"], ct: v["ct"], updated_at: v["updated_at"] };
  }
  throw new NmtsError("The server answered with a file list this version cannot read.", {
    nextStep: "Update this tool, or open the account in a browser to see what is there.",
  });
}

/** base64url SHA-256 of a sealed blob — the value a later list carries as its `prev`. */
async function fingerprint(ct: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ct));
  return Buffer.from(digest).toString("base64url");
}

function statePath(): string {
  return join(configDir(), "file-list-state.json");
}

/**
 * Where this machine keeps one account's sealed file list.
 *
 * ⛔ AN ACCOUNT ID BECOMES PART OF A PATH HERE, so it is CHECKED rather than trusted. Every id this
 *    tool has comes from its own derivation and is base64url, but a value that reaches a path join
 *    unchecked is how `..` becomes a write somewhere else, and the check costs one line.
 */
function keptListPath(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
    throw new NmtsError("That is not an account id this tool derived.", {
      nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
    });
  }
  return join(configDir(), `file-list-${accountId}.json`);
}

/** This machine's copy of one account's sealed file list. */
export interface KeptList {
  /** The version these bytes carry. Higher is newer — the same counter every device syncs by. */
  seq: number;
  /** When THIS MACHINE wrote the copy, RFC3339 on its own clock. */
  savedAt: string;
  /** The sealed blob, base64url: exactly the bytes the server served or this tool wrote. */
  ct: string;
}

function isKeptList(value: unknown): value is KeptList {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "seq") === "number" &&
    typeof Reflect.get(value, "savedAt") === "string" &&
    typeof Reflect.get(value, "ct") === "string"
  );
}

/**
 * The copy this machine holds for an account, or null when it holds none.
 *
 * ⚠ A COPY THAT CANNOT BE READ IS REPORTED AS NO COPY, on purpose. There is nothing to salvage
 *   from a truncated one, the next read of the list replaces it, and a command that refused to
 *   write out a good copy because an old one is unreadable would be refusing the very thing it is
 *   for.
 */
export function readKeptList(accountId: string): KeptList | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(keptListPath(accountId), "utf8"));
    return isKeptList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keep these sealed bytes as this machine's copy.
 *
 * ⛔ NEWER ONLY. A copy is replaced when the version landing is at least the one already kept, and
 *    never when it is older: this machine's record of what it has seen can be lost or cleared, and
 *    a run that then read an older list from the server must not overwrite the newest copy with
 *    it. The record refuses a lower version while it exists; this is what holds when it does not.
 */
function writeKept(accountId: string, seq: number, ct: string): void {
  const held = readKeptList(accountId);
  if (held !== null && held.seq > seq) return;
  const copy: KeptList = { seq, savedAt: new Date().toISOString(), ct };
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(keptListPath(accountId), `${JSON.stringify(copy, null, 2)}\n`, { mode: 0o600 });
}

interface SeenState {
  /** Keyed by account id, so switching accounts is not mistaken for a rollback. */
  [accountId: string]: { seq: number; fingerprint: string };
}

function readSeen(): SeenState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as SeenState) : {};
  } catch {
    // A missing or unreadable record means "nothing to compare against", which is the same
    // position a first run is in. It is not an error and must not stop a listing.
    return {};
  }
}

/**
 * Write down what this machine has seen: the version, the fingerprint, and the bytes.
 *
 * ⛔ ONE FUNCTION FOR BOTH. The detector and the copy describe the same blob, and two functions
 *    would be two chances for a caller to update one and not the other — after which the machine
 *    would hold a copy of one version while claiming to have seen another.
 */
function writeSeen(accountId: string, seq: number, fp: string, ct: string): void {
  const all = readSeen();
  all[accountId] = { seq, fingerprint: fp };
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  // The record goes first: it is the safety device, and a machine that failed to keep a copy must
  // still refuse an older list afterwards.
  writeKept(accountId, seq, ct);
}

/**
 * Record a version this machine WROTE, so the server cannot serve an older one back afterwards.
 *
 * ⛔ ONLY AFTER THE SERVER ACCEPTED IT. Recording a version that lost the compare-and-swap would
 *    leave this machine believing in a list that never existed — and then refusing the real one as
 *    a rollback.
 */
export async function recordWrittenList(accountId: string, seq: number, ct: string): Promise<void> {
  writeSeen(accountId, seq, await fingerprint(ct), ct);
}

/** True when this machine has a record for the account — i.e. a rollback would be visible. */
export function hasSeenBefore(accountId: string): boolean {
  return existsSync(statePath()) && accountId in readSeen();
}

export interface FileList {
  /** null when the account has no list yet — a new account, not an error. */
  manifest: Manifest | null;
  /**
   * base64url SHA-256 of the sealed blob this list came out of. Absent with no list.
   *
   * ⛔ A WRITER NEEDS IT. The next version has to name the blob it continued from, or the fork
   *    check has a hole exactly where a fork would be introduced.
   */
  fingerprint?: string;
  /** The version the sealed blob itself claims. Absent with no list. */
  seq?: number;
  /** What the server's column said, when it disagreed with the sealed value. */
  serverSeqDisagreed?: number;
  /** True when nothing on this machine could have caught a rollback. */
  firstTimeOnThisMachine: boolean;
}

/**
 * Fetch and open the account's file list.
 *
 * `accountCode` is used here and not kept: the file-list key is derived, used, and zeroed. The
 * derivation output holds every other key in the account, so it does not outlive this call.
 */
export async function readFileList(
  base: string,
  apiKey: string,
  accountCode: string,
  accountId: string,
): Promise<FileList> {
  const answer = asResponse(await request(base, "/v1/manifest", { token: apiKey }));
  const first = !hasSeenBefore(accountId);
  if (answer.state === "absent") return { manifest: null, firstTimeOnThisMachine: first };

  const seen = readSeen()[accountId];
  if (seen !== undefined && answer.seq < seen.seq) {
    throw new NmtsError(
      `The server offered file-list version ${answer.seq}; this machine already saw ${seen.seq}.`,
      {
        nextStep:
          "Nothing was changed. A list that goes backwards means an older copy is being served, " +
          "so files added since could be missing from it. Open the account in a browser and " +
          "compare before writing anything.",
      },
    );
  }
  // ⛔ The same version must be the same bytes. Two different blobs at one version number is a
  //    FORK — two devices shown different histories — and it is the one fork check an occasional
  //    reader can actually make. (The chain link inside the list, `prev`, names the blob its
  //    author continued from; between two runs of this tool a browser may have written several
  //    versions, so `prev` will legitimately name a blob this machine never saw. Comparing it
  //    would cry wolf on ordinary use, which is worse than not comparing it.)
  const fp = await fingerprint(answer.ct);
  if (seen !== undefined && answer.seq === seen.seq && fp !== seen.fingerprint) {
    throw new NmtsError(
      `The server offered a different file list at the same version (${answer.seq}).`,
      {
        nextStep:
          "Nothing was changed. One version number can only have one list, so this machine is " +
          "being shown a different history than it was before. Open the account in a browser " +
          "and compare before writing anything.",
      },
    );
  }

  const crypt = await loadCrypto();
  const [from, to] = DERIVED.fileListKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(accountCode));
  const key = derived.slice(from, to);
  derived.fill(0);

  let body: Uint8Array;
  try {
    body = crypt.envelope_open(key, new TextEncoder().encode(AAD.fileList), Buffer.from(answer.ct, "base64url"));
  } catch {
    throw new NmtsError("The file list did not open with this account's key.", {
      nextStep:
        "Either the code belongs to a different account, or the stored bytes are not what this " +
        "account sealed. Nothing was changed.",
    });
  } finally {
    key.fill(0);
  }

  const manifest = await decodeManifest(body);
  body.fill(0);

  const out: FileList = { manifest, seq: manifest.seq, fingerprint: fp, firstTimeOnThisMachine: first };
  // ⛔ The sealed number is the authenticated one, so it is what gets recorded and what a later
  //    run compares against. The column is reported when it differs and otherwise ignored.
  if (manifest.seq !== answer.seq) out.serverSeqDisagreed = answer.seq;
  // ⛔ THE VERSION THAT IS KEPT IS THE SEALED ONE, and so are the bytes it came out of. Believing
  //    the server's column here would let it decide which copy this machine keeps.
  writeSeen(accountId, manifest.seq, fp, answer.ct);
  return out;
}

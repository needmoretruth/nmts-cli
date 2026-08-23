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

function writeSeen(accountId: string, seq: number, fp: string): void {
  const all = readSeen();
  all[accountId] = { seq, fingerprint: fp };
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

/** True when this machine has a record for the account — i.e. a rollback would be visible. */
export function hasSeenBefore(accountId: string): boolean {
  return existsSync(statePath()) && accountId in readSeen();
}

export interface FileList {
  /** null when the account has no list yet — a new account, not an error. */
  manifest: Manifest | null;
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

  const out: FileList = { manifest, seq: manifest.seq, firstTimeOnThisMachine: first };
  // ⛔ The sealed number is the authenticated one, so it is what gets recorded and what a later
  //    run compares against. The column is reported when it differs and otherwise ignored.
  if (manifest.seq !== answer.seq) out.serverSeqDisagreed = answer.seq;
  writeSeen(accountId, manifest.seq, fp);
  return out;
}

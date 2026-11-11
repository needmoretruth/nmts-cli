// Sharing as a library: send one file to another account, list what came in and what went out,
// receive one, and take one back — for the command line, the SDK and a page, with nothing in it
// that needs Node (spec 2026-09-20 unit C).
//
// ⛔ WHY IT IS ITS OWN ENTRY. An app built on NMTS could not share a person's file: the steps lived
//    inside `nmts share` and `nmts receive`, with the terminal wound through them. The commands are
//    now shells over these functions, so what an app sends is what the command sends, byte for
//    byte — the sealing itself is `share.ts`, untouched, and its order is load-bearing.
//
// ⛔ THE SAME FOR EVERY KEY HOLDER. `ShareAccount.bearer` is an API key or a delegation token. A
//    token reaches the sending doors and the account's own code doors only with its `share` bit AND
//    the code's proof (`accountProof`), so the proof is sent on those requests and on no other. An
//    API key is asked for a live human check there instead, and the proof is simply not needed.
//
// ⛔ RECEIVING IS `sharing-inbox.ts`, re-exported here so `./share` is one entry.
//
// ⛔ NO `node:`, NO `Buffer`, NO `process.` — `test/portable-closure.test.ts` walks this file.

import { request } from "./api.ts";
import { fromBase64Url, toBase64Url, utf8 } from "./bytes.ts";
import { AAD, DERIVED, loadCrypto, type CryptoGlue } from "./crypto.ts";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "./drive-paths.ts";
import { NmtsError } from "./errors.ts";
import { readFileList } from "./manifest.ts";
import { BINARY_NAME } from "./product.ts";
import { differentCode, notLiveCode, publicCodeRefusal } from "./public-code-refusals.ts";
import { ensureLiveCode, liveCodes } from "./public-codes.ts";
import { identityMatches, sealShare, type ShareKeys } from "./share.ts";
import { shareKeysAt } from "./share-codes.ts";
import type { ManifestEntry } from "./shared/lib/drive/manifest-codec.ts";

export { addressFromTyped } from "./share.ts";
export { receivedShares, receiveShare } from "./sharing-inbox.ts";
export type { ReceivedFile, ReceivedShare } from "./sharing-inbox.ts";

/** An account as the share doors take it. */
export interface ShareAccount {
  readonly server: string;
  /** What the one auth header carries: an API key or a delegation token. */
  readonly bearer: string;
  readonly code: string;
  readonly accountId: string;
  /** The chain the stored parts are on, as `resolveNetwork` answers it. */
  readonly network: string;
  /** ⛔ base64url of the code's proof, for the sending and code doors only. Absent: not sent. */
  readonly accountProof?: string | undefined;
}

/** One file of the account's list that a share can carry, and its full path. */
export interface ShareableFile {
  readonly entry: ManifestEntry & { dekWrapped: string; contentHashCt: string };
  readonly path: string;
}

/** What a sent share is: its id, the file's name, who it went to and from which code. */
export interface SentShare {
  id: string | null;
  name: string;
  /** The recipient's public code, readable form. */
  recipient: string;
  fromIndex: number;
}

/** The file at `target`, checked for the key and the hash a share carries. */
export async function shareableFileAt(account: ShareAccount, target: string): Promise<ShareableFile> {
  const list = await readFileList(account.server, account.bearer, account.code, account.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to share.", { exitCode: 4 });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), {
    nothingHappened: "Nothing was shared.",
  });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder. Nothing was shared. This version shares one file at a time.",
    });
  }
  const { dekWrapped, contentHashCt } = entry;
  if (dekWrapped === undefined || contentHashCt === undefined) {
    throw new NmtsError(`The file list holds no ${dekWrapped === undefined ? "key" : "hash"} for "${entry.name}".`, {
      exitCode: 4,
      nextStep:
        "A share carries both: the key that opens the file and the hash the recipient checks the " +
        "bytes against. Nothing was shared.",
    });
  }
  return { entry: { ...entry, dekWrapped, contentHashCt }, path: fullPathOf(index, entry) };
}

/**
 * Which live code sends: `as` when named, else the lowest-numbered live one — published first when
 * the account has none, as a first share does.
 *
 * ⛔ THE SAME ON EVERY ROOT. A delegation token reads the code list and publishes the
 *    first code with its `share` bit and the code's proof, the proof this account already carries
 *    for the sending door. Until 2026-11-11 a token could not, and a device whose business held no
 *    key had no road to a code of its own.
 */
async function senderKeys(crypt: CryptoGlue, account: ShareAccount, as: number | undefined, onFirstCode?: () => void): Promise<ShareKeys> {
  const door = { server: account.server, token: account.bearer, accountProof: account.accountProof };
  let codes;
  try {
    ({ list: codes } = await ensureLiveCode(crypt, account.code, door, onFirstCode));
  } catch (error) {
    throw publicCodeRefusal(error);
  }
  const live = liveCodes(codes);
  const sender = as === undefined ? live[0] : live.find((c) => c.index === as);
  if (sender === undefined) throw notLiveCode(as ?? 0);
  const keys = shareKeysAt(crypt, account.code, sender.index);
  if (toBase64Url(keys.address) !== sender.address) {
    keys.wipe();
    throw differentCode();
  }
  return keys;
}

/**
 * Seal one file for one public code and send it.
 *
 * ⛔ THE CALLER HAS ALREADY DECIDED. The command asks its person between `shareableFileAt` and this
 *    call; a program decides by calling. Nothing here asks anybody anything.
 */
export async function sendShare(
  account: ShareAccount,
  file: ShareableFile,
  recipientAddress: Uint8Array,
  options: { as?: number | undefined; onFirstCode?: () => void } = {},
): Promise<SentShare> {
  const crypt = await loadCrypto();
  const { entry } = file;
  let keys: ShareKeys | null = null;
  const derived = crypt.kdf_derive(crypt.account_code_parse(account.code));
  const dataKey = derived.slice(DERIVED.dataKey[0], DERIVED.dataKey[1]);
  derived.fill(0);
  let dek: Uint8Array | null = null;
  let digest: Uint8Array | null = null;
  try {
    dek = crypt.envelope_open(dataKey, utf8(AAD.dekWrap), fromBase64Url(entry.dekWrapped));
    digest = crypt.envelope_open(dataKey, utf8(AAD.contentHash), fromBase64Url(entry.contentHashCt));
    dataKey.fill(0);
    keys = await senderKeys(crypt, account, options.as, options.onFirstCode);

    const answer: unknown = await request(
      account.server,
      `/v1/share-recipients/${encodeURIComponent(toBase64Url(recipientAddress))}`,
      { token: account.bearer },
    );
    const identityB64 = typeof answer === "object" && answer !== null ? Reflect.get(answer, "share_public_key") : null;
    if (typeof identityB64 !== "string") {
      throw new NmtsError("That public code has never published an identity to share to.", {
        exitCode: 4,
        nextStep:
          "Nothing was shared. The code may be right and unused: somebody has to open " +
          "their account once before anything can be encrypted to them.",
      });
    }
    const recipientIdentity = fromBase64Url(identityB64);
    // ⛔ CHECKED BEFORE ANYTHING IS ENCRYPTED TO IT. The engine checks it again inside the wrap;
    //    this exists so the refusal names WHICH thing was wrong.
    if (!identityMatches(crypt, recipientIdentity, recipientAddress)) {
      throw new NmtsError("The identity the server returned is not the one that public code names.", {
        exitCode: 1,
        nextStep: "Nothing was shared. Encrypting to it would hand the file to somebody else.",
      });
    }
    const payload = sealShare(crypt, {
      keys,
      recipientIdentity,
      recipientAddress,
      dek,
      itemId: entry.id,
      name: entry.name,
      size: entry.size,
      digest,
    });
    const created: unknown = await request(account.server, "/v1/shares", {
      token: account.bearer,
      method: "POST",
      body: { item_id: entry.id, recipient_address: toBase64Url(recipientAddress), ...payload },
      ...(account.accountProof === undefined ? {} : { accountProof: account.accountProof }),
    });
    // ⛔ READ BACK, NOT ECHOED. The server returns the address it actually STORED the share under.
    const stored = typeof created === "object" && created !== null ? Reflect.get(created, "recipient_address") : null;
    if (typeof stored !== "string" || stored !== toBase64Url(recipientAddress)) {
      throw new NmtsError("The server filed this share against a different public code.", {
        exitCode: 1,
        nextStep:
          `Withdraw it now with \`${BINARY_NAME} unshare\` and share it again. The file's key was ` +
          `wrapped for the address you typed, so it is not readable by whoever it was filed under.`,
      });
    }
    const id = typeof created === "object" && created !== null ? Reflect.get(created, "id") : null;
    return {
      id: typeof id === "string" ? id : null,
      name: entry.name,
      recipient: crypt.share_address_display(recipientAddress),
      fromIndex: keys.index,
    };
  } finally {
    dataKey.fill(0);
    dek?.fill(0);
    digest?.fill(0);
    keys?.wipe();
  }
}

/** Who one file was shared with: the server's rows, unchanged, beside the file's path and id. */
export async function sentShares(account: ShareAccount, target: string): Promise<{ path: string; itemId: string; rows: unknown[] }> {
  const list = await readFileList(account.server, account.bearer, account.code, account.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to look up.", { exitCode: 4 });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), { nothingHappened: "Nothing was changed." });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder, and a share is of one file.",
    });
  }
  const answer: unknown = await request(account.server, `/v1/shares/sent?item_id=${encodeURIComponent(entry.id)}`, { token: account.bearer });
  const rows: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "shares") : null;
  if (!Array.isArray(rows)) {
    throw new NmtsError("The server's answer did not carry a list of shares.", {
      nextStep: "Nothing was changed. Report it instead of retrying: the shape of the answer is wrong, and the network is fine.",
    });
  }
  return { path: fullPathOf(index, entry), itemId: entry.id, rows };
}

/** Withdraw a share this account sent, or remove one it was sent. A copy already taken stays taken. */
export async function removeShare(account: ShareAccount, id: string): Promise<void> {
  await request(account.server, `/v1/shares/${encodeURIComponent(id)}`, { token: account.bearer, method: "DELETE" });
}

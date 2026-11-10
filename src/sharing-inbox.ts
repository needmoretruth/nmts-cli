// The inbox half of `sharing.ts`: what came in, and taking one of them. Its own file because
// `check:size` measures the sending half; `./share` re-exports both, so a caller sees one entry.
//
// ⛔ RECEIVING FINDS THE ROW IN THE LIST, not by id: the list is what carries the sender's published
//    identity, and without it the envelope cannot be authenticated. The length written is the one
//    the sender sealed, never the server's stored size (`commands/receive.ts` says why).
//
// ⛔ NO `node:`, NO `Buffer`, NO `process.` — `test/portable-closure.test.ts` walks this file.

import { request } from "./api.ts";
import { loadCrypto } from "./crypto.ts";
import { fetchWithKey } from "./download.ts";
import type { PlaintextSink } from "./download-sink.ts";
import { NmtsError } from "./errors.ts";
import { BINARY_NAME } from "./product.ts";
import { openReceived, openSharedDigest, receivedIndex, type ReceivedRow } from "./share.ts";
import { shareKeyRing } from "./share-codes.ts";
import type { ShareAccount } from "./sharing.ts";
import type { ReadOptions } from "./walrus.ts";

/** One received share, opened as far as it would open. Its key never leaves this module. */
export interface ReceivedShare {
  id: string;
  itemId: string;
  /** The file's name and real length as the sender sealed them; null when the row would not open. */
  name: string | null;
  size: number | null;
  /** The sender's public code — only ever set when the open SUCCEEDED. */
  sender: string | null;
  senderRevoked: boolean;
  /** Which of this account's codes it came to, and that code readable. */
  toIndex: number;
  toCode: string;
  createdAt: string;
  /** Why it did not open, for a row that is still listed. */
  problem: string | null;
}

/** A received file, written to the sink and checked against the sender's hash. */
export interface ReceivedFile {
  id: string;
  name: string;
  bytes: number;
  parts: number;
  sender: string | null;
  senderRevoked: boolean;
  toIndex: number;
  toCode: string;
  /** False when the sink took the bytes but did not deliver them (it decides what that means). */
  delivered: boolean;
}

/** The raw rows of `GET /v1/shares/received`, read field by field. */
async function receivedRows(account: ShareAccount): Promise<{ rows: ReceivedRow[]; total: number }> {
  const value: unknown = await request(account.server, "/v1/shares/received", { token: account.bearer });
  if (typeof value !== "object" || value === null) throw new NmtsError("The server's answer was not an object.");
  const rows: unknown = Reflect.get(value, "shares");
  if (!Array.isArray(rows)) throw new NmtsError("The server did not list any shares.");
  const total: unknown = Reflect.get(value, "total");
  return { rows: rows.filter(isRow), total: typeof total === "number" ? total : rows.length };
}

function isRow(value: unknown): value is ReceivedRow {
  if (typeof value !== "object" || value === null) return false;
  for (const name of ["id", "item_id", "dek_share_ct", "name_share_ct", "content_hash_share_ct"]) {
    if (typeof Reflect.get(value, name) !== "string") return false;
  }
  return true;
}

/**
 * Everything shared with this account, each row opened with the code it came to.
 *
 * ⛔ A ROW THAT WILL NOT OPEN IS STILL LISTED, with its reason and no sender. `total` can be larger
 *    than the list: the server's listing is bounded, and a caller that is not told cannot know.
 */
export async function receivedShares(account: ShareAccount): Promise<{ shares: ReceivedShare[]; total: number }> {
  const crypt = await loadCrypto();
  const ring = shareKeyRing(crypt, account.code);
  try {
    const received = await receivedRows(account);
    const shares = received.rows.map((row): ReceivedShare => {
      const o = openReceived(crypt, ring.at(receivedIndex(row)), row);
      o.dek?.fill(0);
      return {
        id: o.id,
        itemId: o.itemId,
        name: o.name,
        size: o.size,
        sender: o.sender,
        senderRevoked: o.senderRevoked,
        toIndex: o.toIndex,
        toCode: ring.at(o.toIndex).display,
        createdAt: o.createdAt,
        problem: o.problem,
      };
    });
    return { shares, total: received.total };
  } finally {
    ring.wipe();
  }
}

/**
 * Receive one share into a sink: find its row in the list, open it, check what it says, then fetch.
 * `sinkFor` is asked once the name and real length are known — the command picks a path from the
 * sender's name there, and a program its own destination.
 */
export async function receiveShare(
  account: ShareAccount,
  id: string,
  sinkFor: (file: { name: string; size: number }) => PlaintextSink,
  read?: ReadOptions,
): Promise<ReceivedFile> {
  const crypt = await loadCrypto();
  const ring = shareKeyRing(crypt, account.code);
  try {
    const answer: unknown = await request(account.server, "/v1/shares/received", { token: account.bearer });
    const rows: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "shares") : null;
    if (!Array.isArray(rows)) throw new NmtsError("The server did not list any shares.");
    const row = rows.find(
      (candidate): candidate is ReceivedRow =>
        typeof candidate === "object" && candidate !== null && Reflect.get(candidate, "id") === id,
    );
    if (row === undefined) {
      throw new NmtsError(`Nothing shared with this account has the id "${id}".`, {
        exitCode: 4,
        nextStep: `Nothing was written. \`${BINARY_NAME} shares\` lists what is there.`,
      });
    }
    const opened = openReceived(crypt, ring.at(receivedIndex(row)), row);
    if (opened.dek === null || opened.name === null) {
      throw new NmtsError(`That share ${opened.problem ?? "did not open"}.`, {
        exitCode: 1,
        nextStep: "Nothing was written. The sender can withdraw it and share the file again.",
      });
    }
    if (opened.size === null) {
      opened.dek.fill(0);
      throw new NmtsError("The sender did not record this file's real length.", {
        exitCode: 1,
        nextStep:
          "Nothing was written. It was shared by an older client; ask them to share it again from " +
          "a current one, which seals the length beside the name.",
      });
    }
    const expected = openSharedDigest(crypt, opened.dek, opened.digestCt);
    if (expected === null) {
      opened.dek.fill(0);
      throw new NmtsError("This share's content hash did not open with the file's own key.", {
        exitCode: 1,
        nextStep: "Nothing was written. There would be nothing to check the bytes against.",
      });
    }
    let sink: PlaintextSink;
    try {
      sink = sinkFor({ name: opened.name, size: opened.size });
    } catch (error) {
      opened.dek.fill(0);
      throw error;
    }
    const fetched = await fetchWithKey({
      base: account.server,
      apiKey: account.bearer,
      descriptorPath: `/v1/shares/${encodeURIComponent(id)}/parts?for=download`,
      size: opened.size,
      dek: opened.dek,
      expected,
      chain: account.network,
      ...(read === undefined ? {} : { read }),
      sink,
    });
    return {
      id,
      name: opened.name,
      bytes: fetched.byteCount,
      parts: fetched.partCount,
      sender: opened.sender,
      senderRevoked: opened.senderRevoked,
      toIndex: opened.toIndex,
      toCode: ring.at(opened.toIndex).display,
      delivered: fetched.delivered,
    };
  } finally {
    ring.wipe();
  }
}

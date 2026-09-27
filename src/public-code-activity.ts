// What each of an account's public codes has been used for: the shares sent from it and the shares
// received with it — `nmts public-code list --activity` and the library's `publicCodes.list`.
//
// ⛔ THE NAMES ARE OPENED HERE, NOT READ FROM THE SERVER. The server knows which code a share went
//    through and nothing about what it holds: a received file's name is sealed by its sender and
//    opens with the code it came to, and a sent file's name is this account's own, in its sealed list.
//
// ⚠ A ROW THAT WILL NOT OPEN IS STILL LISTED, with the reason and no name — the rule `openReceived`
//   keeps for the inbox, for the same reason: leaving it out would say less was received than was.

import { request } from "./api.ts";
import { fromBase64Url } from "./bytes.ts";
import type { CryptoGlue } from "./crypto.ts";
import { buildIndex, fullPathOf } from "./drive-paths.ts";
import { isRecord } from "./guards.ts";
import { readFileList } from "./manifest.ts";
import type { PublicCodeList } from "./public-codes.ts";
import { openReceived, receivedIndex, type ReceivedRow } from "./share.ts";
import { shareKeyRing } from "./share-codes.ts";

/** One share sent from a code. */
export interface SentThrough {
  id: string;
  itemId: string;
  /** Where the file sits in this account, or null when the list no longer holds it. */
  path: string | null;
  /** The recipient's code in the form a person reads, or as the server sent it if it will not parse. */
  recipient: string;
  recipientRevoked: boolean;
  createdAt: string;
}

/** One share received with a code. */
export interface ReceivedThrough {
  id: string;
  /** The name its sender sealed, or null when it would not open — `problem` says why. */
  name: string | null;
  sender: string | null;
  senderRevoked: boolean;
  createdAt: string;
  problem: string | null;
}

export interface CodeActivity {
  sent: SentThrough[];
  received: ReceivedThrough[];
}

/** Where to ask and as whom — the account the code opens, on its server. */
export interface ActivityDoor {
  server: string;
  token: string;
  accountId: string;
}

function readable(crypt: CryptoGlue, wire: string): string {
  try {
    return crypt.share_address_display(fromBase64Url(wire));
  } catch {
    return wire;
  }
}

function rowsOf(answer: unknown): unknown[] {
  return isRecord(answer) && Array.isArray(answer["shares"]) ? answer["shares"] : [];
}

function isReceived(value: unknown): value is ReceivedRow {
  if (!isRecord(value)) return false;
  return ["id", "item_id", "dek_share_ct", "name_share_ct", "content_hash_share_ct"].every(
    (name) => typeof value[name] === "string",
  );
}

/** Every code's shares, by number. A code with none has two empty lists. */
export async function codeActivity(
  crypt: CryptoGlue,
  code: string,
  door: ActivityDoor,
  list: PublicCodeList,
): Promise<Map<number, CodeActivity>> {
  const out = new Map<number, CodeActivity>();
  for (const c of list.codes) out.set(c.index, { sent: [], received: [] });
  const slot = (index: number): CodeActivity => {
    const had = out.get(index);
    if (had !== undefined) return had;
    const made: CodeActivity = { sent: [], received: [] };
    out.set(index, made);
    return made;
  };

  const files = await readFileList(door.server, door.token, code, door.accountId);
  const entries = files.manifest?.entries ?? [];
  const index = buildIndex(entries);
  const pathOf = new Map(entries.map((e) => [e.id, fullPathOf(index, e)]));
  for (const c of list.codes) {
    const answer: unknown = await request(door.server, `/v1/shares/sent?from_index=${c.index}`, { token: door.token });
    for (const row of rowsOf(answer)) {
      if (!isRecord(row)) continue;
      const { id, item_id: itemId, recipient_address: to, created_at: at } = row;
      if (typeof id !== "string" || typeof itemId !== "string" || typeof to !== "string" || typeof at !== "string") continue;
      slot(c.index).sent.push({
        id,
        itemId,
        path: pathOf.get(itemId) ?? null,
        recipient: readable(crypt, to),
        recipientRevoked: row["recipient_code_revoked"] === true,
        createdAt: at,
      });
    }
  }

  const ring = shareKeyRing(crypt, code);
  try {
    const answer: unknown = await request(door.server, "/v1/shares/received", { token: door.token });
    for (const row of rowsOf(answer).filter(isReceived)) {
      const opened = openReceived(crypt, ring.at(receivedIndex(row)), row);
      opened.dek?.fill(0);
      slot(opened.toIndex).received.push({
        id: opened.id,
        name: opened.name,
        sender: opened.sender,
        senderRevoked: opened.senderRevoked,
        createdAt: opened.createdAt,
        problem: opened.problem,
      });
    }
  } finally {
    ring.wipe();
  }
  return out;
}

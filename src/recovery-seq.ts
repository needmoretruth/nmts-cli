// Which recovery list this machine wrote last, so the next one gets a higher number.
//
// ⛔ WHY IT IS STILL REMEMBERED HERE. The account's recorded number is said by
//    `GET /v1/account/recovery-network-copy` (spec 2026-09-20 unit B), and `recovery.ts` asks it
//    first. A server older than that door answers 404 or 405, and a record the server refused or
//    never received still has to push the next number past it. So the two are put together: the
//    next list carries the higher of the two, plus one.
//
// ⛔ WHAT A MISSING SERVER NUMBER COSTS, SAID PLAINLY. A list written from a browser moves the
//    server's number without moving this one. Against an older server the next run here then
//    offers a number the server has already passed, the server refuses it — that is what its `seq`
//    guard is for — and the refusal is reported rather than worked around. The attempt is recorded
//    either way, so a second run offers a higher number and the two converge instead of looping.
//
// ⛔ IT GOES THROUGH THE HOST'S STATE, so the same counter runs in a page. On Node a key without a
//    slash is one file directly under the config directory — the same `recovery-seq-<id>.json`,
//    with the same text, that this module wrote with `node:fs` before (`host-node.ts::placeOf`).
//
// ⛔ IT IS NOT A SECRET AND IT IS STILL WRITTEN 0600. It holds an account id and a counter. The
//    mode matches every other file this tool keeps beside it: one mode is easier to keep right
//    than two.

import { fromUtf8, utf8 } from "./bytes.ts";
import { NmtsError } from "./errors.ts";
import { isRecord } from "./guards.ts";
import { host } from "./host.ts";

/**
 * The state key one account's counter lives under.
 *
 * ⛔ AN ACCOUNT ID BECOMES PART OF A FILE NAME HERE, so it is CHECKED rather than trusted. Every id
 *    this tool has comes from its own derivation and is base64url, but a value that reaches a path
 *    unchecked is how `..` becomes a write somewhere else, and the check costs one line.
 */
function seqKey(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
    throw new NmtsError("That is not an account id this tool derived.", {
      nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
    });
  }
  return `recovery-seq-${accountId}.json`;
}

/** The highest sequence this machine has offered for an account, or 0 when it has offered none. */
export async function lastOfferedSeq(accountId: string): Promise<number> {
  const key = seqKey(accountId);
  try {
    const bytes = await host().state.read(key);
    if (bytes === undefined) return 0;
    const parsed: unknown = JSON.parse(fromUtf8(bytes));
    if (!isRecord(parsed)) return 0;
    const seq = parsed["seq"];
    // A record that cannot be read counts as none, which is where a first run already stands.
    return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
  } catch {
    return 0;
  }
}

/**
 * Write down a sequence this machine OFFERED — whether or not the server took it.
 *
 * ⛔ OFFERED, NOT ACCEPTED, AND THAT IS THE POINT. Recording only the accepted ones would make a
 *    refused number the number the next run offers again, and every run after it: the same
 *    refusal for ever. Recording the attempt is what makes a second run get past it.
 */
export async function rememberOfferedSeq(accountId: string, seq: number): Promise<void> {
  if (seq <= (await lastOfferedSeq(accountId))) return;
  await host().state.write(seqKey(accountId), utf8(`${JSON.stringify({ seq }, null, 2)}\n`));
}

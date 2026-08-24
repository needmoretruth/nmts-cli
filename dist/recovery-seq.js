// Which recovery list this machine wrote last, so the next one gets a higher number.
//
// ⛔ WHY IT IS REMEMBERED HERE AND NOT ASKED FOR. The account's recorded sequence is reported by
//    `GET /v1/account`, and that route is closed to an API key outright (`Reach::Never`) — it is
//    the door that also deletes the account. So a tool holding a key cannot read the number it has
//    to beat, and the only honest alternatives are to remember its own or to guess. It remembers.
//
// ⛔ WHAT THAT COSTS, SAID PLAINLY. A list written from a browser, or from another machine, moves
//    the server's number without moving this one. The next run here then offers a number the
//    server has already passed, the server refuses it — that is what its `seq` guard is for — and
//    the refusal is reported rather than worked around. The attempt is recorded either way, so a
//    second run offers a higher number and the two converge instead of looping.
//
// ⛔ IT IS NOT A SECRET AND IT IS STILL WRITTEN 0600. It holds an account id and a counter. The
//    mode matches every other file this tool keeps beside it: one mode is easier to keep right
//    than two.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "./credentials.js";
import { NmtsError } from "./errors.js";
import { isRecord } from "./guards.js";
/**
 * Where one account's counter lives.
 *
 * ⛔ AN ACCOUNT ID BECOMES PART OF A PATH HERE, so it is CHECKED rather than trusted. Every id this
 *    tool has comes from its own derivation and is base64url, but a value that reaches a path join
 *    unchecked is how `..` becomes a write somewhere else, and the check costs one line.
 */
function seqPath(accountId) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
        throw new NmtsError("That is not an account id this tool derived.", {
            nextStep: "Nothing was written. This is a fault in the tool rather than in the account.",
        });
    }
    return join(configDir(), `recovery-seq-${accountId}.json`);
}
/** The highest sequence this machine has offered for an account, or 0 when it has offered none. */
export function lastOfferedSeq(accountId) {
    try {
        const parsed = JSON.parse(readFileSync(seqPath(accountId), "utf8"));
        if (!isRecord(parsed))
            return 0;
        const seq = parsed["seq"];
        // A record that cannot be read counts as none, which is where a first run already stands.
        return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
    }
    catch {
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
export function rememberOfferedSeq(accountId, seq) {
    if (seq <= lastOfferedSeq(accountId))
        return;
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(seqPath(accountId), `${JSON.stringify({ seq }, null, 2)}\n`, { mode: 0o600 });
}

// `nmts shares --sent` — moved out of `share.ts` whole (that file is measured by `check:size`).

import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { sentShares } from "../sharing.ts";
import { out, shareAccountOf, type ShareOptions } from "./share.ts";

/**
 * `nmts shares --sent <path>` — who ONE file was shared with.
 *
 * ⛔ IT IS THE OTHER DIRECTION OF `shares`, NOT A FILTER ON IT. The inbox answers "what can I
 *    download"; this answers "who can download this", which is the only question a person asking
 *    whether to withdraw a share is actually asking. The server keeps the two in different tables
 *    and gives them different routes, and joining them here would invent a view neither has.
 *
 * ⛔ THE ADDRESS IS PRINTED AS THE SERVER STORED IT. There is no name, no directory and nothing to
 *    look one up against — the recipient of a share is an address and nothing else — so a line
 *    that dressed it up as anything friendlier would be inventing an identity.
 *
 * ⚠ IT ONLY READS. Nothing here changes a share, and `unshare <id>` is what takes the id printed
 *   at the end of a line and withdraws it.
 */
export async function sharesSent(
  target: string | undefined,
  options: ShareOptions = {},
): Promise<number> {
  const say = out(options);
  if (target === undefined || target === "") {
    throw new NmtsError("Say which file to look up.", {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} shares --sent <path>\` — the path as \`${BINARY_NAME} ls\` prints it.`,
    });
  }
  const session = await openSession({ server: options.server, network: options.network });
  const { path, itemId, rows } = await sentShares(shareAccountOf(session), target);

  if (options.json) {
    // ⛔ THE SERVER'S ROWS, UNCHANGED. A reader of this arm is reading the route, and a shape
    //    rewritten here would be a second wire to keep in step with the first.
    say(JSON.stringify({ path, item_id: itemId, shares: rows }));
    return 0;
  }
  if (rows.length === 0) {
    say(`${path} has not been shared with anyone.`);
    return 0;
  }
  say(`${path} is shared with:`);
  // ⚠ WHICH OF THIS ACCOUNT'S CODES SENT IT is said once any row went from a code other than 0.
  const fromShown = rows.some((row) => isRecord(row) && typeof row["from_index"] === "number" && row["from_index"] !== 0);
  for (const row of rows) say(sentLine(row, fromShown));
  return 0;
}

/** One row of `GET /v1/shares/sent`, as a person reads it. */
function sentLine(row: unknown, fromShown: boolean): string {
  const at = (name: string): string => {
    const value: unknown = typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
    if (typeof value !== "string") {
      throw new NmtsError("The server listed a share this version cannot read.", {
        nextStep: "Nothing was changed. A newer version of this tool may understand it.",
      });
    }
    return value;
  };
  const from = fromShown && isRecord(row) && typeof row["from_index"] === "number" ? `  from #${row["from_index"]}` : "";
  const gone = isRecord(row) && row["recipient_code_revoked"] === true ? "  · the recipient has revoked this code" : "";
  return `${at("recipient_address")}  since ${utcDay(at("created_at"))}${from}  share ${at("id")}${gone}`;
}

/** The UTC day of an RFC 3339 instant, `YYYY-MM-DD`. */
function utcDay(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) {
    throw new NmtsError("The server dated a share with something that is not a time.", {
      nextStep: "Nothing was changed. Report it rather than retrying.",
    });
  }
  return at.toISOString().slice(0, 10);
}

/** `nmts unshare <id>` — withdraw a share you sent, or remove one you were sent. */

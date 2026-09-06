// `nmts shares --sent` — moved out of `share.ts` whole (that file is measured by `check:size`).

import { request } from "../api.ts";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";
import { out, type ShareOptions } from "./share.ts";

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
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (list.manifest === null) {
    throw new NmtsError("This account has no file list, so there is nothing to look up.", {
      exitCode: 4,
    });
  }
  const index = buildIndex(list.manifest.entries);
  const entry = entryAt(list.manifest.entries, normalisePath(target), {
    nothingHappened: "Nothing was changed.",
  });
  if (entry.kind !== KIND_FILE) {
    throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
      exitCode: 4,
      nextStep: "That is a folder, and a share is of one file.",
    });
  }
  const path = fullPathOf(index, entry);

  const answer: unknown = await request(
    session.server,
    `/v1/shares/sent?item_id=${encodeURIComponent(entry.id)}`,
    { token: session.apiKey },
  );
  const rows: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "shares") : null;
  if (!Array.isArray(rows)) {
    throw new NmtsError("The server's answer did not carry a list of shares.", {
      nextStep: "Nothing was changed. Report it rather than retrying — the shape, not the network, is wrong.",
    });
  }

  if (options.json) {
    // ⛔ THE SERVER'S ROWS, UNCHANGED. A reader of this arm is reading the route, and a shape
    //    rewritten here would be a second wire to keep in step with the first.
    say(JSON.stringify({ path, item_id: entry.id, shares: rows }));
    return 0;
  }
  if (rows.length === 0) {
    say(`${path} has not been shared with anyone.`);
    return 0;
  }
  say(`${path} is shared with:`);
  for (const row of rows) say(sentLine(row));
  return 0;
}

/** One row of `GET /v1/shares/sent`, as a person reads it. */
function sentLine(row: unknown): string {
  const at = (name: string): string => {
    const value: unknown = typeof row === "object" && row !== null ? Reflect.get(row, name) : undefined;
    if (typeof value !== "string") {
      throw new NmtsError("The server listed a share this version cannot read.", {
        nextStep: "Nothing was changed. A newer version of this tool may understand it.",
      });
    }
    return value;
  };
  return `${at("recipient_address")}  since ${utcDay(at("created_at"))}  share ${at("id")}`;
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

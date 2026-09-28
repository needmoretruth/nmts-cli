// `nmts links` · `nmts links revoke <id>` · `nmts links revoke-all` — every live public link this
// account holds, across all its files, and the two ways to cut them (NCF-3 §5.8), so a person who
// handed out many links can take them all back without going file by file.
//
// ⛔ THE SERVER NAMES FILES BY ID. The path beside each link comes from this account's own sealed
//    file list, opened here; a link whose file is not in that list prints `(not in the file list)`.
//
// ⛔ `revoke-all` IS ONE REQUEST, ALL OR NONE. It sits beside `link revoke` in the gate's `low` tier:
//    it only takes something back, and no copy already downloaded is reached.

import { buildIndex, fullPathOf } from "../drive-paths.ts";
import { NmtsError } from "../errors.ts";
import { listLiveLinks, revokeAllLinks, revokeLink, type LinkAccount, type ListedLink } from "../links.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME } from "../product.ts";
import { openSession } from "../session.ts";

export interface LinksOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
}

const USAGE = `\`${BINARY_NAME} links\` · \`${BINARY_NAME} links revoke <id>\` · \`${BINARY_NAME} links revoke-all\``;

export async function links(sub: string | undefined, operand: string | undefined, options: LinksOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  if (sub !== undefined && sub !== "revoke" && sub !== "revoke-all") {
    throw new NmtsError("Say nothing to list, or `revoke <id>`, or `revoke-all`.", { exitCode: 2, nextStep: USAGE });
  }
  if (sub === "revoke" && (operand === undefined || operand === "")) {
    throw new NmtsError("Say which link id.", { exitCode: 2, nextStep: USAGE });
  }
  const session = await openSession({ server: options.server, network: options.network });
  const account: LinkAccount = { server: session.server, bearer: session.apiKey, code: session.code };

  if (sub === "revoke" && operand !== undefined) {
    await revokeLink(account, operand);
    say(options.json === true ? JSON.stringify({ id: operand, cut: true }) : `${operand}  cut`);
    return 0;
  }
  if (sub === "revoke-all") {
    const cut = await revokeAllLinks(account);
    say(options.json === true ? JSON.stringify({ cut }) : `${cut} ${cut === 1 ? "link" : "links"} cut`);
    return 0;
  }

  const rows = await listLiveLinks(account);
  const paths = await pathsOf(session, rows);
  if (options.json === true) {
    say(JSON.stringify({ links: rows.map((row) => ({ ...row, path: paths.get(row.itemId) ?? null })) }));
    return 0;
  }
  if (rows.length === 0) {
    say("No live public links.");
    return 0;
  }
  for (const row of rows) {
    const path = paths.get(row.itemId) ?? "(not in the file list)";
    const ends = row.expiresAt === null ? "" : `  expires ${row.expiresAt}`;
    say(`${row.id}  ${path}  made ${row.createdAt}  downloads ${row.downloads}${ends}`);
    if (row.link !== null) say(`  ${row.link}`);
  }
  return 0;
}

type Session = Awaited<ReturnType<typeof openSession>>;

/** Each linked file's path, from the account's own sealed list. Nothing to look up, nothing read. */
async function pathsOf(session: Session, rows: readonly ListedLink[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (rows.length === 0) return found;
  const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
  if (list.manifest === null) return found;
  const index = buildIndex(list.manifest.entries);
  for (const row of rows) {
    const entry = index.byId.get(row.itemId);
    if (entry !== undefined) found.set(row.itemId, fullPathOf(index, entry));
  }
  return found;
}

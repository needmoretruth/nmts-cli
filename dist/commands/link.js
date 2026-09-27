// `nmts link make|list|revoke|open` — public links (NCF-3 §5.8). The work is in
// `../links.ts`, which the SDK calls too; this file is the terminal around it.
//
// ⛔ `open` NEEDS NO LOGIN. It reads the link, asks the server for the token only, and writes one file
//    here — the name the owner showed (its last segment), or `nmts-link-<token>` when it was hidden.
//
// ⛔ `make` sits behind the `share` unlock (`risk.ts`), because it gives the file to whoever holds the
//    link. The gate asks for the yes; the trade-off line is what it shows.
//
import { resolve } from "node:path";
import { fileSink } from "../download-sink-node.js";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { listLinks, makeLink, openLink, revokeLink } from "../links.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { readCredentialsFile } from "../credentials.js";
import { destinationFor } from "../safe-path.js";
import { resolveServer } from "../server.js";
import { openSession } from "../session.js";
import { linkExpiryDays } from "../shared/lib/share/public-link.js";
const USAGE = `\`${BINARY_NAME} link make <path> [--hide-name] [--expires <n>d]\` · \`${BINARY_NAME} link list <path>\` · ` +
    `\`${BINARY_NAME} link revoke <id>\` · \`${BINARY_NAME} link open <link> [--out <path>]\``;
export async function link(sub, operand, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    if (sub !== "make" && sub !== "list" && sub !== "revoke" && sub !== "open") {
        throw new NmtsError("Say `make`, `list`, `revoke` or `open`.", { exitCode: 2, nextStep: USAGE });
    }
    if (operand === undefined || operand === "") {
        throw new NmtsError(`Say which ${sub === "revoke" ? "link id" : sub === "open" ? "link" : "file"}.`, {
            exitCode: 2,
            nextStep: USAGE,
        });
    }
    if (sub === "open")
        return await open(operand, options, say);
    if (sub === "revoke") {
        const session = await openSession({ server: options.server, network: options.network });
        await revokeLink(accountOf(session), operand);
        say(options.json === true ? JSON.stringify({ id: operand, cut: true }) : `${operand}  cut`);
        return 0;
    }
    const session = await openSession({ server: options.server, network: options.network });
    const entry = await fileAt(session, operand);
    if (sub === "list") {
        const links = await listLinks(accountOf(session), entry.id);
        if (options.json === true) {
            say(JSON.stringify({ path: operand, links }));
            return 0;
        }
        for (const row of links) {
            const state = row.cutAt === null ? `downloads ${row.downloads}` : `cut ${row.cutAt} by ${row.cutBy ?? "?"}`;
            say(`${row.id}  made ${row.createdAt}  ${state}`);
            if (row.link !== null)
                say(`  ${row.link}`);
        }
        return 0;
    }
    const days = expiryOf(options.expires);
    const made = await makeLink(accountOf(session), entry, { showName: options.hideName !== true, expiresDays: days });
    if (options.json === true) {
        say(JSON.stringify(made));
        return 0;
    }
    say(made.link);
    say(`  id ${made.id}${made.expiresAt === null ? "" : `  expires ${made.expiresAt}`}`);
    return 0;
}
/** `30d` → 30. Absent → never. */
function expiryOf(value) {
    if (value === undefined)
        return null;
    const match = /^([0-9]+)d$/u.exec(value.trim());
    const days = match?.[1] === undefined ? null : linkExpiryDays(Number(match[1]));
    if (days === null) {
        throw new NmtsError(`--expires takes a number of days, like 30d, from 1d to 3650d.`, { exitCode: 2, nextStep: USAGE });
    }
    return days;
}
function accountOf(session) {
    return { server: session.server, bearer: session.apiKey, code: session.code };
}
async function fileAt(session, target) {
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so there is nothing to link.", { exitCode: 4 });
    }
    const entry = entryAt(list.manifest.entries, normalisePath(target), { nothingHappened: "Nothing was changed." });
    if (entry.kind !== KIND_FILE) {
        throw new NmtsError(`No file at "${fullPathOf(buildIndex(list.manifest.entries), entry)}".`, {
            exitCode: 4,
            nextStep: "That is a folder, and a link is to one file.",
        });
    }
    return entry;
}
async function open(text, options, say) {
    // ⛔ No session: a link is opened by whoever holds it. Only where to ask and which network to read.
    const stored = readCredentialsFile();
    const server = resolveServer(options.server ?? stored?.server);
    const chain = resolveNetwork(server, options.network ?? stored?.network);
    let destination = "";
    const opened = await openLink({
        link: text,
        server,
        chain,
        sink: (name) => {
            const token = /\/l\/([A-Za-z0-9_-]{22})/u.exec(text)?.[1] ?? "file";
            destination = options.out !== undefined ? resolve(options.out) : destinationFor(".", name ?? `nmts-link-${token}`);
            return fileSink(destination, { force: options.force === true });
        },
    });
    if (options.json === true) {
        say(JSON.stringify({ name: opened.name, bytes: opened.bytes, out: destination }));
        return 0;
    }
    say(`${opened.name ?? "(name hidden)"}  ${opened.bytes} bytes`);
    say(`  saved to ${destination}, checked against the hash the owner sealed with it`);
    return 0;
}

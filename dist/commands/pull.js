// `nmts pull <folder>` — a whole folder, or a whole account, onto this machine.
//
// ⛔ ONE BAD FILE MUST NOT LOSE NINETEEN GOOD ONES. A single `get` refuses rather than writing a
//    half-right file, and that is right for one file. Applied to two hundred it would mean one
//    unreadable file throws away every file downloaded before it. So each file is attempted on its
//    own, what failed is named at the end, and the exit code says whether anything did.
//
// ⛔ AND A FILE THAT FAILED LEAVES NOTHING — not even the part of it that had already arrived. Each
//    file streams into a temporary name beside where it is going and is renamed into place only
//    once its digest matches, so a pull that stops half way through a large file does not leave
//    something that looks finished. A second run fetches what is missing (`download-sink.ts`).
//
// ⛔ AND NOTHING IS OVERWRITTEN BY DEFAULT. A pull into a directory that already holds files is
//    ordinary — a second run, a resumed transfer — and silently replacing what is there is the one
//    outcome nobody can undo. An existing file is SKIPPED and counted; `--force` replaces.
//
// ⛔ THE TREE IS THE ACCOUNT'S, AND IT IS BUILT UNDER THE DESTINATION AND NOWHERE ELSE. A name in
//    the sealed list is written by whoever holds the account, so it is not to be trusted with a
//    path: a name containing a separator, or dots that climb, would otherwise write outside the
//    directory that was asked for. Every segment is checked before anything is created.
import { mkdirSync, existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fetchFile } from "../download.js";
import { fileSink } from "../download-sink.js";
import { buildIndex, entryAt, fullPathOf, isLive, KIND_FILE, KIND_FOLDER, normalisePath, underPrefix, } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { refuseUnwritableName } from "../safe-path.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
export async function pull(target, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const session = await openSession({ server: options.server, network: options.network });
    const chain = resolveNetwork(session.server, session.network);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so there is nothing to pull.", { exitCode: 4 });
    }
    const entries = list.manifest.entries;
    const index = buildIndex(entries);
    // ⚠ No target means the WHOLE account. It is the same walk from the root, said as its own case
    //   so that `nmts pull` cannot be read as "pull something and I will guess what".
    const root = target === undefined || target === "" || target === "/" ? null : entryAt(entries, normalisePath(target), { nothingHappened: "Nothing was written." });
    if (root !== null && root.kind !== KIND_FOLDER) {
        throw new NmtsError(`"${fullPathOf(index, root)}" is a file.`, {
            exitCode: 4,
            nextStep: `Nothing was written. \`${BINARY_NAME} get\` fetches one file.`,
        });
    }
    const base = resolve(options.out ?? ".");
    const wanted = filesUnder(index, entries, root?.id ?? null);
    if (wanted.length === 0) {
        if (options.json) {
            say(JSON.stringify({ files: 0, written: 0, skipped: 0, failed: 0, out: base }));
            return 0;
        }
        say(`Nothing to pull${root === null ? "" : ` from "${fullPathOf(index, root)}"`}.`);
        return 0;
    }
    const prefix = root === null ? "" : fullPathOf(index, root);
    const outcomes = [];
    for (const entry of wanted) {
        const drivePath = fullPathOf(index, entry);
        const local = safeJoin(base, underPrefix(prefix, drivePath));
        if (existsSync(local) && options.force !== true) {
            outcomes.push({ path: drivePath, bytes: entry.size, state: "skipped" });
            continue;
        }
        if (!options.json)
            say(`  ${drivePath}`);
        try {
            if (entry.dekWrapped === undefined)
                throw new NmtsError("the file list holds no key for it");
            // ⛔ THE DIRECTORY IS MADE BEFORE THE DOWNLOAD, because the file is now written as it is
            //    decrypted: its temporary name lives beside the destination, so the destination's
            //    directory has to exist before the first byte arrives rather than after the last.
            mkdirSync(join(local, ".."), { recursive: true });
            const fetched = await fetchFile({
                base: session.server,
                apiKey: session.apiKey,
                accountCode: session.code,
                itemId: entry.id,
                size: entry.size,
                dekWrapped: entry.dekWrapped,
                ...(entry.contentHashCt === undefined ? {} : { contentHashCt: entry.contentHashCt }),
                chain,
                sink: fileSink(local, { force: options.force === true }),
            });
            outcomes.push({ path: drivePath, bytes: fetched.byteCount, state: "written" });
        }
        catch (error) {
            // ⛔ COUNTED AND CARRIED ON. See the module note: refusing the whole pull over one file is
            //    what makes somebody run it twenty times and lose the same nineteen files each time.
            outcomes.push({
                path: drivePath,
                bytes: entry.size,
                state: "failed",
                why: error instanceof Error ? error.message : String(error),
            });
        }
    }
    const written = outcomes.filter((o) => o.state === "written");
    const skipped = outcomes.filter((o) => o.state === "skipped");
    const failed = outcomes.filter((o) => o.state === "failed");
    if (options.json) {
        say(JSON.stringify({ files: outcomes.length, written: written.length, skipped: skipped.length, failed: failed.map((f) => ({ path: f.path, why: f.why })), out: base }));
        return failed.length === 0 ? 0 : 1;
    }
    say(``);
    say(`${written.length} written · ${skipped.length} already there · ${failed.length} failed`);
    if (skipped.length > 0) {
        say(``);
        say(`  What was already there was left alone. --force replaces it, which cannot be undone.`);
    }
    if (failed.length > 0) {
        say(``);
        for (const one of failed)
            say(`  ${one.path}: ${one.why ?? "failed"}`);
        say(``);
        say(`  Everything else was written. Running this again retries only what is missing.`);
        return 1;
    }
    return 0;
}
/** Every live file at or under `parentId`, in path order. */
function filesUnder(index, entries, parentId) {
    const under = (entry) => {
        if (parentId === null)
            return true;
        let at = entry;
        const seen = new Set();
        while (at !== undefined) {
            if (at.parentId === parentId)
                return true;
            if (at.parentId === null || seen.has(at.parentId))
                return false;
            seen.add(at.parentId);
            at = index.byId.get(at.parentId);
        }
        return false;
    };
    return entries
        .filter((e) => e.kind === KIND_FILE && isLive(index, e) && under(e))
        .sort((a, b) => fullPathOf(index, a).localeCompare(fullPathOf(index, b)));
}
/**
 * Join a drive path onto a local directory, refusing anything that would leave it.
 *
 * ⛔ THE NAMES COME FROM THE SEALED LIST, which is written by whoever holds the account — including
 *    an account somebody else set up. A name with a separator in it, or one made of dots, would
 *    otherwise write outside the directory that was asked for, which is a file appearing somewhere
 *    nobody chose.
 */
function safeJoin(base, drivePath) {
    const segments = drivePath.split("/").filter((s) => s !== "");
    for (const segment of segments) {
        // ⛔ A name this machine cannot hold is refused BEFORE anything is fetched — on Windows some of
        //    them are accepted by the operating system and then keep nothing (see `safe-path.ts`).
        refuseUnwritableName(segment);
        if (segment === "." || segment === ".." || segment.includes(sep) || isAbsolute(segment)) {
            throw new NmtsError(`"${drivePath}" cannot be written to a path on this machine.`, {
                exitCode: 4,
                nextStep: "Nothing was written. Rename it in the drive, then pull again.",
            });
        }
    }
    const full = resolve(base, ...segments);
    const inside = relative(base, full);
    if (inside.startsWith("..") || isAbsolute(inside)) {
        throw new NmtsError(`"${drivePath}" would be written outside the destination.`, { exitCode: 4 });
    }
    return full;
}

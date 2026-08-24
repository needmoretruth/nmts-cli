// `nmts get <path>` — one file back out, decrypted and checked.
//
// ⚠ IT REFUSES RATHER THAN WRITES A HALF-RIGHT FILE. A wrong key, a part that will not decrypt,
//   parts that do not add up to the file the list describes, or a whole-file hash that does not
//   match — none of them leave a file behind. A file on disk is a claim that it is the file, and a
//   partial one makes that claim silently.
//
// ⛔ WHICH IS NOW KEPT BY A RENAME, NOT BY BUFFERING. The file is written as it is decrypted, so it
//   is no longer bounded by memory — a file that can be uploaded can be brought back. The bytes go
//   to a temporary name in the destination's own directory and are renamed into place only after
//   the whole-file digest matches; the temporary file is deleted when anything fails. `--out -`
//   has no rename available and keeps the older bargain instead: see `download-sink.ts`.
//
// ⛔ IT WILL NOT OVERWRITE. An agent that re-runs a command should not destroy what the previous
//   run produced, and neither should a person who forgot the file was there. `--force` is the way
//   to say otherwise, out loud.
//
// ⛔ `--out -` HANDS THE FILE TO WHATEVER IS READING stdout AND WRITES NOTHING. Reading one stored
//   note should not mean leaving a plaintext copy of it on the disk, which is what this command
//   made an agent do until now. The refusals above still happen first, and all of them happen
//   before a byte moves — the file is whole and checked in memory before it is handed over, so a
//   pipe gets a whole file or gets nothing (`stdout.ts`). That is also why this mode, and only
//   this mode, still has a size ceiling and says so out loud when a file is over it.
//
// ⛔ AND IN THAT MODE EVERYTHING A PERSON READS GOES TO stderr — the summary, the missing-hash
//   warning and the `--json` line alike, because stdout is now carrying the file and a second
//   thing on it would be part of the file as far as the reader is concerned.
import { basename, resolve } from "node:path";
import { CODE_ENV_VAR } from "../credentials.js";
import { fetchFile } from "../download.js";
import { fileSink, stdoutSink } from "../download-sink.js";
import { buildIndex, entryAt, fullPathOf, KIND_FILE, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { readFileList } from "../manifest.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { openSession } from "../session.js";
import { processStdout, STDOUT_TARGET } from "../stdout.js";
export async function get(target, options = {}) {
    const toStdout = options.out === STDOUT_TARGET;
    // ⛔ THE HUMAN LINES MOVE OUT OF THE WAY OF THE FILE. When stdout carries the file, a summary
    //    line printed there is not a summary line — it is bytes appended to what the reader thinks
    //    is the file.
    const say = options.write ?? ((line) => (toStdout ? process.stderr : process.stdout).write(`${line}\n`));
    if (target === undefined || target === "") {
        throw new NmtsError("Say which file to get.", {
            exitCode: 2,
            nextStep: `\`${BINARY_NAME} get <path>\` — the path as \`${BINARY_NAME} ls\` prints it.`,
        });
    }
    // ⛔ ONE PLACE RESOLVES THE CREDENTIALS, so the "no API key" refusal — the sentence a new user is
    //    most likely to see — is one text. This command carried its own copy and had already dropped
    //    a sentence the other three keep (2026-08-23).
    const session = await openSession({ server: options.server, network: options.network });
    const chain = resolveNetwork(session.server, session.network);
    const list = await readFileList(session.server, session.apiKey, session.code, session.accountId);
    if (list.manifest === null) {
        throw new NmtsError("This account has no file list, so there is nothing to get.", { exitCode: 4 });
    }
    // ⛔ ONE LOOKUP, SHARED WITH EVERY OTHER COMMAND. This used to walk the parent chain itself and
    //    read only `e.deletedAt`, which made it disagree with `ls` about a broken chain and, worse,
    //    offer a file whose folder had been trashed — the server refuses those bytes
    //    (2026-08-23).
    const index = buildIndex(list.manifest.entries);
    const wanted = normalisePath(target);
    // ⚠ Looked up WITHOUT a kind filter on purpose: a path that names a folder must be told apart
    //   from a path that names nothing, and a filtered lookup can only say "nothing is there".
    const entry = entryAt(list.manifest.entries, wanted, { nothingHappened: "Nothing was written." });
    if (entry.kind !== KIND_FILE) {
        throw new NmtsError(`No file at "${fullPathOf(index, entry)}".`, {
            exitCode: 4,
            nextStep: "That is a folder. Nothing was written — this version gets one file at a time.",
        });
    }
    if (entry.dekWrapped === undefined) {
        throw new NmtsError(`The file list holds no key for "${wanted}".`, {
            exitCode: 4,
            nextStep: "Without it nothing can open the stored bytes. Open the account in a browser.",
        });
    }
    const destination = toStdout ? null : resolve(options.out ?? basename(entry.name));
    // ⛔ `--force` has nothing to overwrite on the stdout branch and is ignored there on purpose:
    //    there is no file to protect, and refusing the combination would only make a wrapper script
    //    harder to write. On the disk branch the sink refuses an occupied name BEFORE the download,
    //    which the old code could only do after fetching the whole file.
    const sink = destination === null
        ? stdoutSink(options.stdout ?? processStdout())
        : fileSink(destination, { force: options.force === true });
    const fetched = await fetchFile({
        base: session.server,
        apiKey: session.apiKey,
        accountCode: session.code,
        itemId: entry.id,
        size: entry.size,
        dekWrapped: entry.dekWrapped,
        contentHashCt: entry.contentHashCt,
        chain,
        sink,
    });
    // The reader closed the pipe first. It got what it asked for and stopped; saying anything now
    // would be writing to a pipe nobody is holding — see `handOver`.
    if (!fetched.delivered)
        return 0;
    if (options.json) {
        say(JSON.stringify({
            path: wanted,
            // ⛔ `-` and not a path, because no path was written. A caller that treats this field as a
            //    file name would otherwise create one — the exact copy this mode exists to avoid.
            writtenTo: destination ?? STDOUT_TARGET,
            bytes: fetched.byteCount,
            parts: fetched.partCount,
            contentHashChecked: fetched.contentHashChecked,
        }));
        return 0;
    }
    say(`${destination ?? "stdout"}  ${fetched.byteCount} bytes  from ${fetched.partCount} stored part${fetched.partCount === 1 ? "" : "s"}`);
    // ⛔ Said out loud when it is absent. "Verified" and "nothing to verify against" are different
    //    facts, and only one of them means the bytes were checked.
    if (!fetched.contentHashChecked) {
        say(``);
        say(`  This file has no recorded hash in the file list, so nothing here could check the whole`);
        say(`  file against one. Every part still decrypted under this account's key.`);
    }
    return 0;
}

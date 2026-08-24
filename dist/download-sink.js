// Where a downloaded file's plaintext goes WHILE it is still being produced.
//
// ⛔ THE PROMISE THAT WAS KEPT BY BUFFERING IS NOW KEPT HERE. Until now `download.ts` held every
//    decrypted byte, checked the whole-file digest the account had sealed, and only then handed a
//    finished array to a caller that wrote it out. That is why a half-right file never appeared
//    under a real name. It also meant a file that could be uploaded — uploads go part by part and
//    are bounded by one part — could not be brought back on a machine smaller than the file.
//    Streaming moves bytes before the last chunk is checked, so the promise has to be kept by the
//    DESTINATION instead: a file lands under a temporary name and is renamed into place only after
//    the digest matches, and a failure takes the temporary file with it.
//
// ⛔ A SINK MUST NOT KEEP THE ARRAY IT IS HANDED. The caller zeroes each run of plaintext as soon
//    as `write` resolves, so a sink that stored the reference would hold a buffer full of zeroes
//    and write them out. Copy, or finish with the bytes before resolving.
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { NmtsError } from "./errors.js";
import { handOver } from "./stdout.js";
/** The one refusal text for a destination that is already occupied. Shared by every command. */
function alreadyThere(destination) {
    return new NmtsError(`${destination} already exists.`, {
        exitCode: 4,
        nextStep: "Nothing was written. Pass --out to choose another name, or --force to replace it.",
    });
}
/**
 * Write to a file, through a temporary name beside it, renamed into place only when the whole
 * file has been proved.
 *
 * ⛔ THE TEMPORARY FILE IS IN THE SAME DIRECTORY AS THE DESTINATION, not in a system temporary
 *    directory, and that is the whole mechanism: `rename` is atomic only within one filesystem,
 *    and only an atomic rename guarantees that a reader either sees nothing under the real name or
 *    sees the finished file. A temporary directory can be — and on the machines this runs on
 *    usually is — a different filesystem, where the same call becomes copy-then-delete and a
 *    reader can catch the copy half done.
 *
 * ⛔ IT IS CREATED 0600 AND THE RENAME KEEPS THAT. The file is somebody's plaintext; it must not
 *    be readable by other accounts on the machine for the seconds it takes to download, any more
 *    than it may be afterwards.
 */
export function fileSink(destination, options) {
    // ⛔ Asked BEFORE the download rather than at the end, which is where the old code found out.
    //    Fetching a file to discover it had nowhere to go spent somebody's time and the storage
    //    network's bandwidth for a refusal that was knowable up front.
    if (!options.force && existsSync(destination))
        throw alreadyThere(destination);
    const temporary = join(dirname(destination), `.${basename(destination)}.nmts-${randomBytes(6).toString("hex")}.part`);
    let stream = null;
    let failure = null;
    let renamed = false;
    // ⚠ Created on the first write rather than up front: a download that fails before it produces a
    //   byte — a wrong key, a part on a network this build cannot read — then leaves no file at all,
    //   not even one that appears and disappears.
    const opened = () => {
        if (stream !== null)
            return stream;
        const fresh = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
        // ⛔ An 'error' with no listener is thrown out of the event loop and kills the process, which
        //    would turn "the disk is full" into a crash with no next step. Kept, and reported by the
        //    next call that can report it.
        fresh.on("error", (error) => {
            failure = error;
        });
        stream = fresh;
        return fresh;
    };
    const closed = async () => {
        const open = stream;
        if (open === null)
            return;
        stream = null;
        // ⚠ Waits for 'close', not 'finish': a stream that failed to open never finishes, and waiting
        //   for the wrong event there is a hang rather than an error.
        await new Promise((resolve) => {
            if (open.closed) {
                resolve();
                return;
            }
            open.once("close", () => resolve());
            open.end();
        });
    };
    const abandon = async () => {
        if (renamed)
            return;
        try {
            await closed();
        }
        catch {
            // Nothing to do about it: the file below is going away either way.
        }
        await rm(temporary, { force: true }).catch(() => undefined);
    };
    return {
        // Nothing to refuse: what a disk cannot take, the write itself reports, and the temporary
        // file means a disk that fills up leaves no file under the name somebody asked for.
        expect: () => undefined,
        write: async (bytes) => {
            const target = opened();
            await new Promise((resolve, reject) => {
                const known = failure;
                if (known !== null) {
                    reject(known);
                    return;
                }
                target.write(bytes, (error) => {
                    if (error === undefined || error === null)
                        resolve();
                    else
                        reject(error);
                });
            });
        },
        commit: async () => {
            // A file of zero bytes is still a file, so the stream is opened even if nothing was written.
            opened();
            await closed();
            const known = failure;
            if (known !== null) {
                await abandon();
                throw new NmtsError(`${destination} could not be written: ${known.message}`, {
                    exitCode: 1,
                    nextStep: "Nothing was left under that name. The download itself was fine — this is the disk.",
                });
            }
            // ⛔ Asked a second time, as late as possible. The first check was before the download; a
            //    file that appeared in the meantime is somebody else's, and rename would silently
            //    replace it. The window is now the width of one system call rather than a download.
            if (!options.force && existsSync(destination)) {
                await abandon();
                throw alreadyThere(destination);
            }
            await rename(temporary, destination);
            renamed = true;
            return true;
        },
        abandon,
    };
}
/**
 * How much plaintext `--out -` will hold before it hands anything over. One part's worth.
 *
 * ⛔ NOT AN ARBITRARY NUMBER: it is the upload path's default part size, which is the most memory
 *    this tool has ever asked for. Keeping the stdout ceiling there means the whole tool's bound
 *    is one part plus one chunk whichever direction the bytes are going.
 */
export const STDOUT_HOLD_LIMIT = 64 * 2 ** 20;
/**
 * Hand the whole file to whatever is reading stdout — after it has been proved, not during.
 *
 * ⛔ THERE IS NO RENAME ON A PIPE, so the trick the file path uses is not available: a byte handed
 *    to a reader cannot be taken back, and a reader that has already consumed half a file cannot
 *    be told afterwards that the half was wrong. An exit code does not fix that — `nmts get x
 *    --out - > y` leaves the truncated bytes in `y` whatever the exit code says, and an agent
 *    reading a pipe usually acts on what it read. So this branch keeps the ORIGINAL guarantee
 *    rather than the original size: the file is held, checked, and only then handed over, exactly
 *    as before streaming existed.
 *
 * ⛔ WHICH MEANS IT HAS TO REFUSE SOMEWHERE, AND IT REFUSES OUT LOUD AND EARLY. Above the ceiling
 *    the answer is a refusal naming `--out <name>`, which streams and is checked before the file
 *    appears — not a silent trade of the guarantee for the size, and not the out-of-memory crash
 *    that this used to be. `put` already refuses this way rather than discovering a limit halfway.
 *
 * ⚠ Every protection this branch already had is still here and still applies to the whole file:
 *   bytes a terminal would act on are refused (`readableOnATerminal`), a reader that closed the
 *   pipe first is an ordinary end and not a failure, and any other write failure throws.
 */
export function stdoutSink(to, limit = STDOUT_HOLD_LIMIT) {
    const held = [];
    let total = 0;
    const tooLarge = (size) => new NmtsError(`This file is ${size} bytes, and \`--out -\` hands over at most ${limit}.`, {
        exitCode: 4,
        nextStep: "Nothing was written and nothing was sent. A pipe cannot be taken back, so this mode " +
            "proves the whole file before it sends a byte, which means holding it. Use `--out <name>` " +
            "— that writes any size, and the file only appears under that name once it has been checked.",
    });
    const forget = () => {
        for (const run of held)
            run.fill(0);
        held.length = 0;
    };
    return {
        expect: (size) => {
            if (size > limit)
                throw tooLarge(size);
        },
        write: async (bytes) => {
            // ⚠ Copied, because the caller zeroes what it handed over as soon as this resolves.
            total += bytes.length;
            if (total > limit) {
                forget();
                throw tooLarge(total);
            }
            held.push(new Uint8Array(bytes));
        },
        commit: async () => {
            const whole = new Uint8Array(total);
            let at = 0;
            for (const run of held) {
                whole.set(run, at);
                at += run.length;
            }
            forget();
            // ⚠ NOT zeroed afterwards, deliberately: `ByteDestination` promises only that the bytes have
            //   been handed over, and a destination is entitled to keep the array it was given — the
            //   tests use one that does. Wiping it here would hand a reader a buffer of zeroes.
            return await handOver(whole, to);
        },
        abandon: async () => forget(),
    };
}

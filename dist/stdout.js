// Handing a file's bytes to whatever is reading this program's stdout, instead of to the disk.
//
// ⛔ THIS EXISTS SO THAT READING A FILE DOES NOT MEAN LEAVING ONE. Everything else in this tool
//    works to keep plaintext in as few places as possible, and until this was here an agent that
//    wanted to read one stored note had to write that note to the disk first — a copy nobody asked
//    for, in a directory nobody chose, that outlives the read.
//
// ⛔ A WHOLE FILE OR NOTHING — AND ON THIS PATH THAT STILL MEANS HOLDING IT. The disk path no
//    longer does: a download is written as it is decrypted, under a temporary name, and renamed
//    into place only once the whole-file digest matches, so it is bounded by one part rather than
//    by the file. A pipe has no rename. A byte handed to a reader cannot be taken back, and a
//    reader that has already consumed half a file cannot be told afterwards that the half was
//    wrong — so bytes still reach this module only after `download.ts` has proved the file whole,
//    which is why this takes a buffer and not a stream. The ceiling that comes with that, and the
//    refusal above it, are in `download-sink.ts` (`stdoutSink`).
//
// ⛔ A TERMINAL IS NOT A PIPE, AND THIS TELLS THEM APART. See `readableOnATerminal`.
import { NmtsError } from "./errors.js";
/** What `--out` is spelled as when the file goes to stdout. The spelling every tool shares. */
export const STDOUT_TARGET = "-";
/**
 * Whether these bytes can go to a terminal without the terminal acting on them.
 *
 * ⛔ A TERMINAL EXECUTES WHAT IT IS SENT. An escape sequence stored in a file can retitle the
 *    window, blank the screen, change what the reader's next keystrokes mean, and on terminals
 *    that answer queries it can put text of its choosing into their next command line. So the
 *    question is not "will this look like rubbish" — it is "does this contain instructions", and
 *    the answer decides whether the bytes are refused or written. A pipe is a different question
 *    and gets a different answer: a program reading this is expected to handle whatever it asked
 *    for, and refusing binary there would make the whole option useless.
 *
 * ⚠ Tab, newline and carriage return are the three control characters that mean in a terminal
 *   exactly what they mean in a text file, so they pass.
 *
 * ⚠ Bytes that are not well-formed UTF-8 fail too, and not for tidiness: what a terminal does with
 *   a broken sequence is its own business, and this is somebody else's terminal.
 */
export function readableOnATerminal(bytes) {
    for (const byte of bytes) {
        if (byte === 0x09 || byte === 0x0a || byte === 0x0d)
            continue;
        if (byte < 0x20 || byte === 0x7f)
            return false;
    }
    try {
        // Checked after the scan above, which is cheap and turns away most binary before this
        // allocates a string the size of the file.
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        return false;
    }
    return true;
}
/** This program's own stdout, as a destination. */
export function processStdout() {
    return {
        isTerminal: process.stdout.isTTY === true,
        write: (bytes) => new Promise((resolve, reject) => {
            // ⛔ WAITED FOR, NOT FIRED AND FORGOTTEN. On a pipe Node's stdout is asynchronous: a
            //    caller that returned as soon as `write` did could not tell a full disk from a
            //    finished write, and would report success for bytes that never arrived.
            process.stdout.write(bytes, (error) => {
                if (error === undefined || error === null)
                    resolve();
                else
                    reject(error);
            });
        }),
    };
}
/**
 * Hand the whole file over, refusing rather than writing bytes a terminal would act on.
 *
 * Answers false when the program reading it closed the pipe before the file was done — `nmts get
 * big.bin --out - | head -c 100` is an ordinary thing to do, and the reader that stopped listening
 * is the one that decided it had enough. Every other failure throws: a caller must not be able to
 * mistake "the disk filled up half way" for "handed over".
 */
export async function handOver(bytes, to) {
    if (to.isTerminal && !readableOnATerminal(bytes)) {
        throw new NmtsError("These bytes are not text and stdout is a terminal.", {
            exitCode: 4,
            nextStep: "Nothing was written. A terminal acts on some of what it is sent, so this refuses rather " +
                "than sending it. Redirect it (`--out - > file`), pipe it into something that reads " +
                "bytes, or pass `--out <name>` to write the file instead.",
        });
    }
    try {
        await to.write(bytes);
    }
    catch (error) {
        const code = error instanceof Error && "code" in error ? Reflect.get(error, "code") : null;
        if (code === "EPIPE")
            return false;
        // ⛔ Named, and never reported as success. Some of the file may already have gone; what is
        //    certain is that the whole file did not, and the exit code has to say so.
        //
        // ⚠ The cause is safe to interpolate, and that is worth saying because `errors.ts` explains
        //   how it usually is not: a stream's failure is its own errno line (`write ENOSPC`), which
        //   never quotes the bytes it was handed.
        throw new NmtsError(`The file could not be handed over: ${error instanceof Error ? error.message : String(error)}`, {
            exitCode: 1,
            nextStep: "Whatever was reading this did not get the whole file. If it was redirected, what is " +
                "there now is part of one.",
        });
    }
    return true;
}

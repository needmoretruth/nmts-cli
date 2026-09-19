import type { PlaintextSink } from "./download-sink.ts";
import { type ByteDestination } from "./stdout.ts";
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
export declare function fileSink(destination: string, options: {
    force: boolean;
}): PlaintextSink;
/**
 * How much plaintext `--out -` will hold before it hands anything over. One part's worth.
 *
 * ⛔ NOT AN ARBITRARY NUMBER: it is the upload path's default part size, which is the most memory
 *    this tool has ever asked for. Keeping the stdout ceiling there means the whole tool's bound
 *    is one part plus one chunk whichever direction the bytes are going.
 */
export declare const STDOUT_HOLD_LIMIT: number;
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
export declare function stdoutSink(to: ByteDestination, limit?: number): PlaintextSink;

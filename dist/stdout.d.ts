/** What `--out` is spelled as when the file goes to stdout. The spelling every tool shares. */
export declare const STDOUT_TARGET = "-";
/** Somewhere a whole file can be handed to, once. */
export interface ByteDestination {
    /** True when these bytes would land on a terminal rather than a pipe, a file or another program. */
    isTerminal: boolean;
    /** Resolves when the bytes have been handed over; rejects with the reason they were not. */
    write(bytes: Uint8Array): Promise<void>;
}
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
export declare function readableOnATerminal(bytes: Uint8Array): boolean;
/** This program's own stdout, as a destination. */
export declare function processStdout(): ByteDestination;
/**
 * Hand the whole file over, refusing rather than writing bytes a terminal would act on.
 *
 * Answers false when the program reading it closed the pipe before the file was done — `nmts get
 * big.bin --out - | head -c 100` is an ordinary thing to do, and the reader that stopped listening
 * is the one that decided it had enough. Every other failure throws: a caller must not be able to
 * mistake "the disk filled up half way" for "handed over".
 */
export declare function handOver(bytes: Uint8Array, to: ByteDestination): Promise<boolean>;

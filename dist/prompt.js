// Reading a secret from a terminal without putting it on the screen.
//
// ⛔ WHY NOT `readline`. It echoes what is typed, and an account code on screen ends up in
//    scrollback, in a screen share, and in the terminal recording some agents keep. The usual
//    workaround — swapping `process.stdout.write` for a muted one while the question is open — is
//    a global mutation in a process that may be writing other output, and it stays broken if the
//    promise rejects between the swap and the restore. This reads the raw stream instead: nothing
//    global changes, and echo never happens because nothing echoes it.
//
// ⚠ THIS REQUIRES A REAL TERMINAL. When stdin is a pipe — which is how an agent usually runs this
//    tool — there is nothing to prompt, and waiting would hang on a stream that will never carry a
//    keystroke. The caller is told to use the environment variable, which is the right answer for
//    an agent anyway.
//
// The keystroke rules live in secret-reader.ts and are tested without a terminal.
import { NmtsError } from "./errors.js";
import { SecretReader } from "./secret-reader.js";
/**
 * Bytes typed ahead at a prompt that has already closed, waiting for the next one.
 *
 * ⛔ MODULE STATE, AND IT HAS TO BE. The thing being carried across is one keyboard, and each
 *    prompt is a separate call — there is nowhere else for it to live. It holds only what a
 *    person typed at this process's own terminal, it is cleared as it is consumed, and nothing
 *    reads it but the next prompt.
 */
let pending = new Uint8Array(0);
/**
 * Hold the terminal in raw mode across a RUN of prompts.
 *
 * ⛔ WITHOUT THIS, THE GAP BETWEEN TWO PROMPTS ECHOES. `promptSecret` sets raw mode for its own
 *    question and restores it afterwards, which was right while this tool asked one thing. `login`
 *    now asks three in a row with work in between (the code is checked before a passphrase is
 *    asked for), and in that gap the terminal is back in line mode: it echoes what is typed, and
 *    its line discipline holds whole lines that the next prompt then never sees. Measured through
 *    a pty: a paste of code + passphrase + confirmation ended in "Cancelled" with both
 *    passphrases printed on the screen.
 *
 * ⚠ Restoring is what the `finally` is for, including on a throw — a process that exits leaving a
 *   terminal in raw mode leaves the person's shell unusable.
 */
export async function holdTerminal(body) {
    const stdin = process.stdin;
    if (!stdinIsATerminal())
        return body();
    const was = stdin.isRaw === true;
    stdin.setRawMode(true);
    try {
        return await body();
    }
    finally {
        stdin.setRawMode(was);
        // Anything typed past the last question belongs to nobody. It is not carried out of here.
        pending.fill(0);
        pending = new Uint8Array(0);
    }
}
export function stdinIsATerminal() {
    return process.stdin.isTTY === true;
}
/** Ask for a secret on the terminal, echoing nothing. Ctrl-C and Ctrl-D abandon the prompt. */
export async function promptSecret(question, envVar) {
    if (!stdinIsATerminal()) {
        throw new NmtsError("There is no terminal to type into (stdin is not a TTY).", {
            exitCode: 3,
            nextStep: `Set ${envVar} in the environment instead.`,
        });
    }
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    const reader = new SecretReader();
    // ⛔ TYPED-AHEAD INPUT IS ANSWERED FIRST. A terminal delivers a pasted block as ONE chunk, so
    //    somebody answering three prompts with three pasted lines sends all three before the second
    //    prompt exists. Reading only from the stream would throw the last two away — and `login`
    //    asks three questions in a row, so that was the ordinary case, not the odd one.
    if (pending.length > 0) {
        const carried = pending;
        pending = new Uint8Array(0);
        const ahead = reader.push(carried);
        carried.fill(0);
        if (ahead.kind !== "more") {
            pending = reader.takeLeftover();
            process.stderr.write(`${question}\n`);
            if (ahead.kind === "cancelled") {
                reader.wipe();
                throw new NmtsError("Cancelled.", { exitCode: 130 });
            }
            return ahead.value;
        }
    }
    // ⛔ THE QUESTION GOES TO STDERR, NOT STDOUT. A prompt is not output: stdout is what a caller
    //    parses, redirects and — under `nmts mcp` — reads as protocol. An adversarial review caught
    //    this one: a passphrase prompt written to stdout put non-protocol bytes on the MCP wire,
    //    where the other end sees a parse error and the tool simply disappears.
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    try {
        return await new Promise((resolve, reject) => {
            const onData = (chunk) => {
                const step = reader.push(chunk);
                if (step.kind === "more")
                    return;
                stdin.off("data", onData);
                process.stderr.write("\n");
                if (step.kind === "cancelled") {
                    reader.wipe();
                    reject(new NmtsError("Cancelled.", { exitCode: 130 }));
                    return;
                }
                pending = reader.takeLeftover();
                resolve(step.value);
            };
            stdin.on("data", onData);
        });
    }
    finally {
        reader.wipe();
        stdin.setRawMode(wasRaw);
        stdin.pause();
    }
}

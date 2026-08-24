// The keystroke rules for typing a secret, with no terminal attached.
//
// ⛔ WHY THIS IS ITS OWN FILE. The first version of this logic zeroed the buffer inside the same
//    branch that then read it, so the answer came back as a run of NUL bytes — a defect that a
//    terminal-attached function cannot be tested for without a terminal. Split out, the rules are
//    a pure function over bytes and every rule below has a test that goes red on its own.
const CTRL_C = 0x03;
const CTRL_D = 0x04;
const BACKSPACE = 0x7f;
const BACKSPACE_ALT = 0x08;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;
const ESCAPE = 0x1b;
const CSI = 0x5b;
/**
 * Accumulates typed bytes into a secret.
 *
 * ⛔ `wipe()` is separate from `take()` on purpose: the caller reads the value and only then
 *    clears the buffer. Doing both in one step is what produced the NUL-run defect this file
 *    exists to make impossible.
 */
export class SecretReader {
    #bytes = [];
    // ⛔ AN ARROW KEY IS THREE BYTES, NOT ONE. A terminal sends ESC [ A; dropping only the ESC (it
    //    is a control byte) leaves `[A` sitting in the middle of the secret, and the person sees
    //    nothing because nothing is echoed. They then get a wrong-code error they cannot explain.
    //    So the whole sequence is consumed: after ESC [, bytes are swallowed until the final byte
    //    of a CSI sequence (0x40–0x7e), which is where the terminal protocol says it ends.
    #escape = "none";
    /**
     * Whatever followed the newline in the chunk that finished the last answer.
     *
     * ⚠ It is bytes a person typed at a prompt that is now closed — which is the NEXT prompt's
     *   input. It never contains anything the caller did not send here.
     */
    #leftover = new Uint8Array(0);
    /** Bytes that arrived after the answer ended, for the prompt that comes next. */
    takeLeftover() {
        const out = this.#leftover;
        this.#leftover = new Uint8Array(0);
        return out;
    }
    /** Feed one chunk. Returns what the caller should do next. */
    push(chunk) {
        let index = -1;
        for (const byte of chunk) {
            index += 1;
            if (this.#escape !== "none") {
                this.#consumeEscape(byte);
                continue;
            }
            if (byte === ESCAPE) {
                this.#escape = "saw-escape";
                continue;
            }
            if (byte === CTRL_C)
                return { kind: "cancelled" };
            if (byte === CTRL_D && this.#bytes.length === 0)
                return { kind: "cancelled" };
            if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
                // ⛔ WHAT CAME AFTER THE NEWLINE IS KEPT, NOT DROPPED. A person answering three prompts by
                //    pasting three lines sends all of them in ONE chunk; a reader that stopped at the
                //    first newline and threw the rest away lost the next two answers, and the run ended
                //    in "Cancelled" — which reads as something the person did.
                // ⛔ COPIED, NOT A VIEW. `chunk` is the stream's own buffer and Node reuses it for the
                //    next read; `Buffer.prototype.slice` returns a window onto that same memory, so what
                //    was kept here would be overwritten — or zeroed by the caller wiping the chunk it was
                //    handed. Measured: the next prompt read an empty buffer and the run ended in
                //    "Cancelled". The constructor copies; `slice` on a Buffer does not.
                this.#leftover = new Uint8Array(chunk.subarray(index + 1));
                return { kind: "done", value: this.take() };
            }
            if (byte === BACKSPACE || byte === BACKSPACE_ALT) {
                this.#bytes.pop();
                continue;
            }
            // Any other control byte is not part of a secret.
            if (byte < 0x20)
                continue;
            this.#bytes.push(byte);
        }
        return { kind: "more" };
    }
    /** Swallow one byte of a terminal escape sequence. */
    #consumeEscape(byte) {
        if (this.#escape === "saw-escape") {
            // ESC followed by [ opens a CSI sequence; ESC followed by anything else is a two-byte
            // sequence that ends right here.
            this.#escape = byte === CSI ? "in-csi" : "none";
            return;
        }
        // In a CSI sequence the final byte is in 0x40–0x7e; everything before it is a parameter.
        if (byte >= 0x40 && byte <= 0x7e)
            this.#escape = "none";
    }
    /** The value typed so far, with surrounding spaces removed. Clears the buffer. */
    take() {
        const value = Buffer.from(this.#bytes).toString("utf8").trim();
        this.wipe();
        return value;
    }
    /** Drop the bytes without reading them. */
    wipe() {
        this.#bytes.fill(0);
        this.#bytes.length = 0;
        this.#escape = "none";
    }
    /** How many bytes are held. For tests; never printed. */
    get length() {
        return this.#bytes.length;
    }
}

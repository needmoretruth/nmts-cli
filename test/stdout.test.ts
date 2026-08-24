// Handing a file to stdout: what may go to a terminal, and what happens when the write fails.
//
// ⛔ THE ASSERTIONS ARE ON BYTES, NOT ON STRINGS. A stored file is not text and this path exists
//    so that it need not become text; a test that compared decoded strings would pass on a
//    version that mangled every byte above 0x7f.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { parseArgs } from "../src/args.ts";
import { NmtsError } from "../src/errors.ts";
import { type ByteDestination, handOver, readableOnATerminal, STDOUT_TARGET } from "../src/stdout.ts";

/** A destination that keeps what it was given. */
function opening(isTerminal: boolean): { taken: Uint8Array[]; to: ByteDestination } {
  const taken: Uint8Array[] = [];
  return {
    taken,
    to: {
      isTerminal,
      write: async (bytes) => {
        taken.push(bytes);
      },
    },
  };
}

/** A destination whose write fails the way a stream does — an `Error` carrying an errno code. */
function refusing(code: string): ByteDestination {
  return {
    isTerminal: false,
    write: () => Promise.reject(Object.assign(new Error(`write ${code}`), { code })),
  };
}

const utf8 = new TextEncoder();

test("what a terminal may be sent, and what it may not", () => {
  const cases: [string, Uint8Array, boolean][] = [
    ["ordinary text", utf8.encode("hello, drive\n"), true],
    ["tabs and carriage returns are text", utf8.encode("a\tb\r\nc"), true],
    // ⛔ Discriminating: a version that allowed only bytes below 0x80 would refuse this, and most
    //    of the world's notes would stop being readable without a redirect.
    ["text outside ASCII", utf8.encode("Grüße · café · こんにちは · 🙂"), true],
    ["nothing at all", new Uint8Array(0), true],
    ["a NUL byte", new Uint8Array([0x68, 0x00, 0x69]), false],
    // ⛔ The one that matters. This is well-formed UTF-8, so a check that only decoded would let
    //    a stored file retitle the reader's window.
    ["an escape sequence", utf8.encode("\u001b]0;taken over\u0007"), false],
    ["a DEL byte", new Uint8Array([0x41, 0x7f]), false],
    ["bytes that are not UTF-8 at all", new Uint8Array([0xff, 0xfe, 0x80]), false],
  ];
  for (const [what, bytes, expected] of cases) {
    assert.equal(readableOnATerminal(bytes), expected, `${what} was judged wrongly`);
  }
});

test("⛔ bytes a terminal would act on are refused, and nothing is handed over", async () => {
  const { taken, to } = opening(true);
  const failure = await handOver(new Uint8Array([0x1b, 0x5b, 0x32, 0x4a]), to).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, "an escape sequence was painted onto a terminal");
  assert.equal(failure.exitCode, 4);
  assert.match(failure.nextStep ?? "", /Nothing was written/);
  assert.equal(taken.length, 0, "it refused and wrote anyway");
});

test("the same bytes go through a pipe untouched — the refusal is about terminals only", async () => {
  const payload = new Uint8Array([0x1b, 0x00, 0xff, 0xfe, 0x41]);
  const { taken, to } = opening(false);
  assert.equal(await handOver(payload, to), true);
  assert.deepEqual(taken, [payload]);
});

test("text is handed to a terminal", async () => {
  const { taken, to } = opening(true);
  assert.equal(await handOver(utf8.encode("one line\n"), to), true);
  assert.deepEqual(taken[0], utf8.encode("one line\n"));
});

test("a reader that closed the pipe is not a failure — `--out - | head` is ordinary", async () => {
  assert.equal(await handOver(utf8.encode("x"), refusing("EPIPE")), false);
});

test("⛔ any other write failure is a failure — a full disk must not read as a finished file", async () => {
  const failure = await handOver(utf8.encode("x"), refusing("ENOSPC")).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, "a write that failed was reported as handed over");
  assert.equal(failure.exitCode, 1);
  assert.match(failure.message, /ENOSPC/, "the cause was swallowed");
});

test("`--out -` parses as a value in both spellings, and a missing value is still an error", () => {
  assert.equal(parseArgs(["get", "notes.txt", "--out", STDOUT_TARGET]).out, STDOUT_TARGET);
  assert.equal(parseArgs(["get", "notes.txt", `--out=${STDOUT_TARGET}`]).out, STDOUT_TARGET);
  // ⛔ Discriminating: allowing a lone dash must not mean allowing the next option to be eaten as
  //    a file name, which is how `--out --force` would silently write a file called `--force`.
  assert.throws(() => parseArgs(["get", "notes.txt", "--out", "--force"]), NmtsError);
  assert.throws(() => parseArgs(["get", "notes.txt", "--out"]), NmtsError);
});

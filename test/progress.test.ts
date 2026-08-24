// Reporting progress — and the two audiences it has to tell apart.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { Progress, countingFetch, silentSink, type ProgressSink } from "../src/progress.ts";

function capture(interactive: boolean): { sink: ProgressSink; lines: string[] } {
  const lines: string[] = [];
  return { sink: { write: (text) => void lines.push(text), interactive }, lines };
}

test("a terminal gets a rewriting line, to a tenth of a percent", () => {
  const { sink, lines } = capture(true);
  const p = new Progress(sink, "uploading");
  p.update(1, 1000);
  p.update(123, 1000);
  p.update(1000, 1000);
  assert.ok(lines.every((line) => line.startsWith("\r")), "every line rewrites the previous one");
  assert.match(lines[1] ?? "", /12\.3%/, "a tenth of a percent is shown, not a whole one");
});

test("⛔ a pipe gets plain lines, not a thousand carriage returns", () => {
  // An agent capturing stdout would otherwise have to strip control characters before it could
  // find the answer.
  const { sink, lines } = capture(false);
  const p = new Progress(sink, "uploading");
  for (let i = 0; i <= 1000; i += 1) p.update(i, 1000);
  assert.ok(lines.every((line) => !line.includes("\r")), "no carriage returns went into the pipe");
  assert.ok(lines.length <= 11, `a pipe got ${lines.length} lines; it should get about ten`);
  assert.ok(lines.every((line) => line.endsWith("\n")));
});

test("the same number is never printed twice", () => {
  const { sink, lines } = capture(true);
  const p = new Progress(sink, "x");
  // A gigabyte upload calls back far more often than the display can change.
  for (let i = 0; i < 5000; i += 1) p.update(i, 1_000_000);
  assert.equal(new Set(lines).size, lines.length, "a repeated percentage was written again");
});

test("a zero-length total reports nothing rather than dividing by zero", () => {
  const { sink, lines } = capture(true);
  new Progress(sink, "x").update(0, 0);
  assert.deepEqual(lines, []);
});

test("`--json` gets a reporter that says nothing at all", () => {
  const p = new Progress(silentSink(), "x");
  p.update(5, 10);
  p.done();
  // Nothing to assert but the absence of a throw: the point is that no sink was written to.
  assert.ok(true);
});

test("finishing prints the closing line only when something was drawn", () => {
  const quiet = capture(true);
  new Progress(quiet.sink, "x").done();
  assert.deepEqual(quiet.lines, [], "nothing was drawn, so nothing has to be closed");

  const busy = capture(true);
  const p = new Progress(busy.sink, "x");
  p.update(1, 2);
  p.done();
  assert.match(busy.lines.at(-1) ?? "", /100\.0%/);
  assert.match(busy.lines.at(-1) ?? "", /\n$/, "the line is ended, so the next output starts clean");
});

test("the counting fetch reports the bytes that actually left, and sends all of them", async () => {
  const body = new Uint8Array(700_000).fill(7);
  const seen: number[] = [];
  let received: Uint8Array | null = null;

  // A stand-in for the network: reads the streaming body to the end and reports what it got.
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const chunks: Uint8Array[] = [];
    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    received = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      received.set(c, at);
      at += c.length;
    }
    return new Response("ok");
  }) as typeof globalThis.fetch;

  try {
    const f = countingFetch((sent, total) => seen.push(sent / total), 100_000);
    await f("https://relay.example", { method: "POST", body });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(received?.length, body.length, "every byte of the body reached the other end");
  assert.equal(seen.at(-1), 1, "the last report is the whole body");
  assert.ok(seen.length > 1, "progress was reported more than once");
  assert.deepEqual([...seen].sort((a, b) => a - b), seen, "the reports only ever go forward");
});

test("a body that is not bytes is passed through untouched", async () => {
  let sawInit: RequestInit | undefined;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sawInit = init;
    return new Response("ok");
  }) as typeof globalThis.fetch;
  try {
    await countingFetch(() => {})("https://x.example", { method: "GET" });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(sawInit?.method, "GET");
  assert.equal(sawInit?.body, undefined, "nothing was invented for a request that had no body");
});

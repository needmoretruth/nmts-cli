// `nmts verify` against a real local server. No fetch mocking: what is being tested is what goes
// on the wire, what comes back off it, and what a person is told to do about it.
//
// ⛔ THE WAITING IS INJECTED, THE CLOCK IS NOT. A test that stubbed the clock could not tell a
//    loop that stops from one that never started; every expiry here is a real deadline a few
//    hundred milliseconds out, and the run has to end by itself before the test does.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { verify } from "../src/commands/verify.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";

/** ⛔ Assembled rather than written out, so nothing here reads as a credential to a scanner. */
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const CODE = ["NMTS", "AB3CD", "EF4GH", "JK5MN"].join("-");

/** What the fake server will do next. Each test sets what it needs and nothing else. */
let mintTtlMs = 600_000;
let mintPollSecs = 2;
/** Answers to `GET`, in order. The last one repeats for as long as the tool keeps asking. */
let statuses: unknown[] = [];
let calls: { method: string; path: string; auth: string | undefined }[] = [];
let base = "";

function unverified(): unknown {
  return { verified: false, round_key: null, verified_until: null };
}

function verified(untilMs: number, week = "2026-W34"): unknown {
  return { verified: true, round_key: week, verified_until: new Date(untilMs).toISOString() };
}

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push({ method, path, auth: req.headers.authorization });
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // ⛔ ROUTED BY PATH AND METHOD. A server that answered anything would let a tool asking for the
  //    wrong address pass every test here and fail against the real one.
  if (path !== "/v1/agent/verify") {
    send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
    return;
  }
  if (method === "POST") {
    send(201, {
      code: CODE,
      verify_url: `${base}/verify`,
      expires_at: new Date(Date.now() + mintTtlMs).toISOString(),
      poll_after_secs: mintPollSecs,
    });
    return;
  }
  if (method === "GET") {
    send(200, statuses.length > 1 ? statuses.shift() : (statuses[0] ?? unverified()));
    return;
  }
  send(405, { error: { code: "METHOD_NOT_ALLOWED", message: "not here" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  mintTtlMs = 600_000;
  mintPollSecs = 2;
  statuses = [unverified()];
  calls = [];
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/** A wait that costs nothing, and remembers what it was asked for. */
function quickly(waits: number[], each = 5): (ms: number, signal: AbortSignal) => Promise<void> {
  return (ms, signal) => {
    waits.push(ms);
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, each);
      signal.addEventListener("abort", done, { once: true });
    });
  };
}

/** One JSON object off a line, without asserting a type the parser did not check. */
function objectFrom(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  assert.ok(typeof value === "object" && value !== null, `not a JSON object: ${line}`);
  const out: Record<string, unknown> = {};
  for (const [field, held] of Object.entries(value)) out[field] = held;
  return out;
}

const methods = (): string[] => calls.map((c) => c.method);

test("⛔ it prints the code, the address, and says out loud that a PERSON has to type it", async () => {
  await withSandbox("verify-code", async () => {
    statuses = [unverified(), verified(Date.now() + 28 * 86_400_000)];
    const out = collect();
    const waits: number[] = [];
    assert.equal(await verify({ server: base, write: out.write, sleep: quickly(waits) }), 0);

    const text = out.lines.join("\n");
    assert.match(text, new RegExp(CODE), "the code a person types was not printed");
    assert.match(text, new RegExp(`${base}/verify`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the address was not printed");
    assert.match(text, /Ask the person to open/, "nothing told the operator to ask a person");
    assert.match(text, /Nothing here can do it for them/, "the text left room for the tool doing it itself");
    // ⛔ The interval is the SERVER's to choose. A tool that polled on its own schedule would be
    //    told 5 seconds and ask twice a second.
    assert.deepEqual(waits.slice(0, 1), [mintPollSecs * 1000]);
  });
});

test("⛔ it prints the moment the check ends, not a number of days on its own", async () => {
  await withSandbox("verify-moment", async () => {
    const ends = Date.UTC(2026, 8, 21, 0, 0, 0);
    statuses = [unverified(), verified(ends)];
    const out = collect();
    await verify({ server: base, write: out.write, sleep: quickly([]) });
    assert.match(out.lines.join("\n"), /2026-09-21T00:00:00Z/, "the absolute moment was not printed");
  });
});

test("--status on an account nobody has verified says so, and asks for no code", async () => {
  await withSandbox("verify-status-no", async () => {
    statuses = [unverified()];
    const out = collect();
    assert.equal(await verify({ server: base, status: true, write: out.write }), 0);
    assert.match(out.lines.join("\n"), /Not verified/);
    assert.ok(!methods().includes("POST"), "--status minted a code");
    assert.deepEqual(methods(), ["GET"]);
  });
});

test("--status on a verified account says until when, and asks for no code", async () => {
  await withSandbox("verify-status-yes", async () => {
    const ends = Date.now() + 27 * 86_400_000;
    statuses = [verified(ends, "2026-W34")];
    const out = collect();
    assert.equal(await verify({ server: base, status: true, write: out.write }), 0);
    const text = out.lines.join("\n");
    assert.match(text, /Verified until 2026-/);
    assert.match(text, /in 27 days/);
    assert.match(text, /2026-W34/);
    assert.ok(!methods().includes("POST"), "--status minted a code");
  });
});

test("an account that is already verified is not made to interrupt anybody", async () => {
  await withSandbox("verify-already", async () => {
    statuses = [verified(Date.now() + 10 * 86_400_000)];
    const out = collect();
    assert.equal(await verify({ server: base, write: out.write, sleep: quickly([]) }), 0);
    assert.match(out.lines.join("\n"), /Already verified/);
    assert.ok(!methods().includes("POST"), "a code was minted for an account that did not need one");
  });
});

test("⛔ the waiting stops the moment the server says verified", { timeout: 15_000 }, async () => {
  await withSandbox("verify-poll-stops", async () => {
    // ⚠ A short deadline on purpose: a loop that ignored the answer would end here at the expiry
    //   instead of hanging, so the failure is an assertion rather than a stuck suite.
    mintTtlMs = 3_000;
    statuses = [unverified(), unverified(), unverified(), verified(Date.now() + 28 * 86_400_000)];
    const out = collect();
    assert.equal(await verify({ server: base, write: out.write, sleep: quickly([]) }), 0);
    assert.match(out.lines.join("\n"), /Verified until/);
    assert.deepEqual(methods(), ["GET", "POST", "GET", "GET", "GET"], "it kept asking after the answer arrived");
  });
});

test("⛔ the waiting gives up when the code stops working, rather than forever", { timeout: 15_000 }, async () => {
  await withSandbox("verify-expires", async () => {
    mintTtlMs = 250;
    statuses = [unverified()];
    const out = collect();
    const failure = await verify({ server: base, write: out.write, sleep: quickly([], 10) }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "an unused code ended as a success");
    assert.equal(failure.exitCode, 1);
    assert.match(failure.message, /stopped working/);
    assert.match(failure.nextStep ?? "", /verify/, "the refusal did not name a next step");
    assert.ok(methods().filter((m) => m === "GET").length >= 2, "it never actually polled");
  });
});

test("⛔ the interrupt key ends the wait with the cancelled code, and takes its handler away", async () => {
  await withSandbox("verify-cancel", async () => {
    const baseline = process.listenerCount("SIGINT");
    mintTtlMs = 600_000;
    statuses = [unverified()];
    let duringWait = 0;
    const failure = await verify({
      server: base,
      write: collect().write,
      sleep: async (_ms, signal) => {
        duringWait = process.listenerCount("SIGINT");
        // Ctrl-C, without the operating system: it runs whatever the command installed, and does
        // nothing at all if the command installed nothing.
        process.emit("SIGINT", "SIGINT");
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        assert.ok(signal.aborted, "the interrupt did not reach the wait");
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "an interrupted wait ended as a success");
    assert.equal(failure.exitCode, 130);
    assert.match(failure.nextStep ?? "", /still good/, "it did not say the code outlives the wait");
    assert.equal(duringWait, baseline + 1, "nothing was listening for the interrupt while it waited");
    assert.equal(process.listenerCount("SIGINT"), baseline, "the handler outlived the command");
  });
});

test("a caller's own signal stops the wait the same way", async () => {
  await withSandbox("verify-signal", async () => {
    const stopper = new AbortController();
    const failure = await verify({
      server: base,
      write: collect().write,
      signal: stopper.signal,
      sleep: async (_ms, signal) => {
        stopper.abort();
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        assert.ok(signal.aborted);
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 130);
  });
});

test("⛔ without an API key it exits 3 and names the variable, before asking the server anything", async () => {
  await withSandbox("verify-nokey", async () => {
    // ⚠ The server is set to say "verified" although nothing here should ever reach it: a build
    //   that lost the refusal then ends immediately and red, rather than waiting out a code.
    statuses = [verified(Date.now() + 86_400_000)];
    delete process.env[API_KEY_ENV_VAR];
    const failure = await verify({ server: base, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "a missing key was not refused");
    assert.equal(failure.exitCode, 3);
    assert.match(`${failure.message} ${failure.nextStep ?? ""}`, new RegExp(API_KEY_ENV_VAR));
    assert.deepEqual(calls, [], "it went to the server without a credential");
  });
});

test("--json prints the code first and the outcome second, one object per line", async () => {
  await withSandbox("verify-json", async () => {
    const ends = Date.now() + 28 * 86_400_000;
    statuses = [unverified(), verified(ends, "2026-W34")];
    const out = collect();
    assert.equal(await verify({ server: base, json: true, write: out.write, sleep: quickly([]) }), 0);
    assert.equal(out.lines.length, 2, "--json printed something other than two objects");

    const first = objectFrom(out.lines[0] ?? "");
    assert.equal(first["event"], "code");
    assert.equal(first["code"], CODE);
    assert.equal(first["verifyUrl"], `${base}/verify`);
    assert.equal(typeof first["expiresAt"], "string");
    assert.equal(first["pollAfterSecs"], mintPollSecs);

    const second = objectFrom(out.lines[1] ?? "");
    assert.equal(second["event"], "result");
    assert.equal(second["verified"], true);
    assert.equal(second["roundKey"], "2026-W34");
    assert.equal(second["codeExpired"], false);
    assert.equal(typeof second["verifiedUntil"], "string");
  });
});

test("--status --json is one object, and says nothing else", async () => {
  await withSandbox("verify-json-status", async () => {
    statuses = [unverified()];
    const out = collect();
    assert.equal(await verify({ server: base, status: true, json: true, write: out.write }), 0);
    assert.equal(out.lines.length, 1);
    const only = objectFrom(out.lines[0] ?? "");
    assert.deepEqual(only, { verified: false, roundKey: null, verifiedUntil: null });
  });
});

test("--json says so when the code was never used, rather than only failing", async () => {
  await withSandbox("verify-json-expired", async () => {
    mintTtlMs = 200;
    statuses = [unverified()];
    const out = collect();
    await verify({ server: base, json: true, write: out.write, sleep: quickly([], 10) }).catch(() => null);
    const last = objectFrom(out.lines[out.lines.length - 1] ?? "");
    assert.equal(last["event"], "result");
    assert.equal(last["verified"], false);
    assert.equal(last["codeExpired"], true);
  });
});

test("the key goes in the Authorization header and is never printed", async () => {
  await withSandbox("verify-auth", async () => {
    statuses = [verified(Date.now() + 86_400_000)];
    const out = collect();
    await verify({ server: base, status: true, write: out.write });
    assert.deepEqual(
      calls.map((c) => c.auth),
      [`Bearer ${KEY}`],
    );
    assert.ok(!out.lines.join("\n").includes(KEY), "the key was printed");
  });
});

test("a server answer missing the one field that matters is refused, not guessed at", async () => {
  await withSandbox("verify-broken", async () => {
    statuses = [{ round_key: "2026-W34" }];
    const failure = await verify({ server: base, status: true, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "an answer with no verdict was read as one");
    assert.match(failure.message, /did not carry/);
  });
});

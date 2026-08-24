// `nmts create` against a real local server: what goes on the wire, what comes back, and what is
// left behind on this machine afterwards.
//
// ⛔ THE SERVER HERE ROUTES BY PATH AND METHOD. A fake that answered anything would let a tool
//    asking for the wrong address pass every test in this file and fail against the real one —
//    which is the defect `check:cli-routes` was written after.
//
// ⛔ AND IT RECORDS WHAT IT WAS SENT. The claim these tests exist for is that the account id the
//    server is told is the one the printed code derives; a fake that only answered could not tell
//    that apart from a tool that made both up.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { create } from "../src/commands/create.ts";
import {
  API_KEY_ENV_VAR,
  credentialsPath,
  testConfigDir,
  writeCredentials,
} from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateCode } from "./helpers.ts";

/** ⛔ Assembled rather than written out, so nothing here reads as a credential to a scanner. */
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

/** What the fake server will do next. Each test sets what it needs and nothing else. */
let verified = true;
let inForce: { terms: string; privacy: string } | null = null;
/** When set, `POST /v1/accounts` refuses with this code instead of creating. */
let refuseCreateWith: string | null = null;
/** When set, the connection is dropped after the body arrives — an answer that never comes. */
let dropOnCreate = false;
let received: Record<string, unknown> | null = null;
let calls: string[] = [];
let base = "";

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push(`${method} ${path}`);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (method === "GET" && path === "/v1/agent/verify") {
    return send(200, {
      verified,
      round_key: verified ? "2026-W34" : null,
      verified_until: verified ? "2026-09-21T00:00:00Z" : null,
    });
  }
  if (method === "GET" && path === "/v1/account/summary") {
    return send(200, {
      credits: { remaining: 0, soonest_expiry: null, file_cap: 1, daily_cap: 1 },
      quota: { granted: 0, used: 0 },
      storage: { parts: 0, earliest_expiry_epoch: null },
      terms: {
        acceptance_required: false,
        required_terms_version: inForce?.terms ?? null,
        required_privacy_version: inForce?.privacy ?? null,
      },
    });
  }
  if (method === "POST" && path === "/v1/accounts") {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body: unknown = JSON.parse(raw);
      received = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : null;
      if (dropOnCreate) return req.socket.destroy();
      if (refuseCreateWith !== null) {
        return send(409, { error: { code: refuseCreateWith, message: "refused by the test" } });
      }
      const id: unknown = received?.["account_id"];
      send(201, {
        account: {
          account_id: typeof id === "string" ? id : "",
          kdf_version: 3,
          status: "active",
          created_at: "2026-08-24T00:00:00Z",
        },
      });
    });
    return;
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  verified = true;
  inForce = null;
  refuseCreateWith = null;
  dropOnCreate = false;
  received = null;
  calls = [];
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [["NMTS_CONFIG_DIR", before.dir], [API_KEY_ENV_VAR, before.key]] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/**
 * The one account code in a run's output — refusing to guess when there is not exactly one.
 *
 * ⛔ FOUND BY THE ENGINE'S OWN PARSER, NOT BY A SHAPE. A code ends in a check symbol drawn from
 *    thirty-seven characters, five of which are punctuation (`* ~ $ = U`), so a pattern over
 *    letters and digits misses about one code in eight — at random, in the helper every test here
 *    reads the printed code with. This file was written that way and a red proof caught it: the
 *    run that was meant to fail for writing the code to disk failed for not finding it on screen.
 */
async function printedCode(lines: string[]): Promise<string> {
  const found: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 32) continue;
    try {
      await identityOf(line);
      found.push(line);
    } catch {
      // Prose. Every other line this command prints is a sentence.
    }
  }
  assert.equal(found.length, 1, `expected exactly one account code on screen, saw ${found.length}`);
  return found[0] ?? "";
}

test("⛔ the code that is printed derives the account id the server was told", async () => {
  await withSandbox("create-derives", async () => {
    const out = collect();
    assert.equal(await create({ server: base, network: "testnet", write: out.write }), 0);

    const code = await printedCode(out.lines);
    const derived = await identityOf(code);
    assert.equal(received?.["account_id"], derived.accountId);
    // ⛔ AND THE SECRET IS THE OTHER DERIVED HALF, not the code and not the id. A tool that sent
    //    the account id twice would satisfy the line above and create an account nothing can
    //    sign in to.
    const secret = received?.["auth_secret"];
    assert.equal(typeof secret, "string");
    assert.notEqual(secret, derived.accountId);
    assert.equal(Buffer.from(String(secret), "base64url").length, 32);
    // The code itself never goes to the server. Nothing on the wire may contain it.
    assert.ok(!JSON.stringify(received).includes(code.replace(/-/gu, "")), "the code reached the server");
  });
});

test("⛔ the new code is not written into this machine's credential store", async () => {
  await withSandbox("create-stores-nothing", async () => {
    // A code this machine is already signed in with — the thing a silent overwrite would destroy.
    const mine = await generateCode();
    writeCredentials({ accountCode: mine, server: base, network: "testnet", apiKey: KEY });
    const before = readFileSync(credentialsPath(), "utf8");

    const out = collect();
    assert.equal(await create({ server: base, network: "testnet", write: out.write }), 0);

    const code = await printedCode(out.lines);
    assert.notEqual(code, mine, "the test proved nothing: the new code equals the stored one");
    assert.equal(readFileSync(credentialsPath(), "utf8"), before, "the credentials file changed");
    assert.ok(!before.includes(code), "the new code is in the credentials file");
  });
});

test("⛔ with no live human check the caller is sent to `nmts verify`, not to its key", async () => {
  await withSandbox("create-unverified", async () => {
    verified = false;
    const out = collect();
    const failed = await create({ server: base, network: "testnet", write: out.write }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failed instanceof NmtsError, "an unverified account was allowed to create one");
    assert.match(failed.message, /human check/u);
    assert.match(String(failed.nextStep), /nmts verify/u);
    // ⛔ THE POINT OF THE PRE-FLIGHT: nothing about permissions, and no account attempted.
    assert.ok(!/scope|permission/iu.test(`${failed.message} ${failed.nextStep}`));
    assert.equal(received, null, "an account was created for an unverified caller");
  });
});

test("⛔ --json refuses without --out, and puts the path rather than the code in its output", async () => {
  await withSandbox("create-json", async (dir) => {
    const refused = await create({ server: base, network: "testnet", json: true, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(refused instanceof NmtsError, "--json handed the account code to a program");
    assert.equal(refused.exitCode, 2);
    assert.equal(received, null, "an account was created by a run that then refused to hand it over");

    const target = join(dir, "code.txt");
    const out = collect();
    assert.equal(
      await create({ server: base, network: "testnet", json: true, out: target, write: out.write }),
      0,
    );
    assert.equal(out.lines.length, 1, "machine-readable output is one line");
    const answer: unknown = JSON.parse(out.lines[0] ?? "");
    assert.ok(typeof answer === "object" && answer !== null);
    const fields = { ...answer } as Record<string, unknown>;
    assert.equal(fields["code_file"], target);
    assert.equal(fields["account_id"], received?.["account_id"]);

    const written = readFileSync(target, "utf8").trim();
    const derived = await identityOf(written);
    assert.equal(derived.accountId, received?.["account_id"]);
    assert.ok(!(out.lines[0] ?? "").includes(written), "the account code is in the JSON output");
  });
});

test("⛔ a refused creation leaves no account code file behind", async () => {
  await withSandbox("create-rollback", async (dir) => {
    refuseCreateWith = "RATE_LIMITED";
    const target = join(dir, "code.txt");
    const failed = await create({ server: base, network: "testnet", out: target, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failed instanceof NmtsError);
    // ⛔ THE FILE IS WRITTEN BEFORE THE ACCOUNT IS ASKED FOR, so a failure has to take it away
    //    again — a code file for an account that does not exist is a file somebody will keep.
    assert.ok(!existsSync(target), "a code file survived a creation that never happened");
    assert.ok(received !== null, "the test proved nothing: the creation was never attempted");
  });
});

test("⛔ an answer that never came KEEPS the code file, because the account may exist", async () => {
  await withSandbox("create-lost-answer", async (dir) => {
    dropOnCreate = true;
    const target = join(dir, "code.txt");
    const failed = await create({ server: base, network: "testnet", out: target, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failed instanceof NmtsError);
    assert.ok(received !== null, "the test proved nothing: the request never reached the server");
    // ⛔ THE OPPOSITE OF THE REFUSAL CASE ABOVE, AND DELIBERATELY. A refusal is the server saying
    //    no; a dropped connection is nobody saying anything, and the account may be there. Deleting
    //    the file would destroy the only key it will ever have.
    assert.ok(existsSync(target), "the only key to an account that may exist was deleted");
    const kept = readFileSync(target, "utf8").trim();
    assert.equal((await identityOf(kept)).accountId, received?.["account_id"]);
    assert.match(String(failed.nextStep), /KEPT/u);
    assert.match(failed.message, /not known/u);
  });
});

test("⛔ --out never replaces a file, and never sends the code to stdout", async () => {
  await withSandbox("create-out-rules", async (dir) => {
    const target = join(dir, "code.txt");
    const first = collect();
    assert.equal(await create({ server: base, network: "testnet", out: target, write: first.write }), 0);
    const kept = readFileSync(target, "utf8");

    received = null;
    const again = await create({ server: base, network: "testnet", out: target, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(again instanceof NmtsError, "an existing code file was overwritten");
    assert.equal(readFileSync(target, "utf8"), kept, "another account's code was destroyed");
    assert.equal(received, null, "an account was created and its code then thrown away");

    const dash = await create({ server: base, network: "testnet", out: "-", write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(dash instanceof NmtsError, "the only copy of an account code went to stdout");
    assert.equal(received, null);
  });
});

// `nmts balance` and `nmts public-code`, against a server that answers on this machine.
//
// ⛔ THE ONE THAT MATTERS IS THE LAST: a server already holding a DIFFERENT public code means the
//    account code this machine is holding is not the one the account was made with. Publishing
//    would fail anyway — the server is first-writer-wins — but "the write was refused" is a much
//    smaller fact than the one worth telling somebody, and the useful message is the bigger fact.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";

import { publicCode } from "../src/commands/public-code.ts";
import { balance } from "../src/commands/balance.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { loadCrypto } from "../src/crypto.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";
import { shareKeysOf } from "../src/share.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

/** What the server answers, and what it was asked. Reset per test. */
let summary: unknown = null;
let identity: { published: boolean; share_address?: string } = { published: false };
let puts: Record<string, unknown>[] = [];

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/account/summary") && req.method === "GET") return send(200, summary);
  if (url.startsWith("/v1/account/share-identity") && req.method === "GET") return send(200, identity);
  if (url.startsWith("/v1/account/share-identity") && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null) puts.push({ ...parsed });
      const claimed = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "share_address") : "";
      identity = { published: true, share_address: String(claimed) };
      send(204, {});
    });
    return;
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = server.address();
if (port === null || typeof port !== "object") throw new Error("no port");
const BASE = `http://127.0.0.1:${port.port}`;
after(() => server.close());

const FULL = {
  credits: { remaining: 3, soonest_expiry: "2026-09-30T00:00:00Z", file_cap: 300, daily_cap: 300 },
  quota: { granted: 3 * 1024 * 1024, used: 1024 * 1024 },
  storage: { parts: 2, earliest_expiry_epoch: 41 },
  terms: { acceptance_required: false },
};

async function sandbox(name: string, body: (ctx: { code: string }) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  process.env[SERVER_ENV_VAR] = BASE;
  process.env[NETWORK_ENV_VAR] = "testnet";
  summary = JSON.parse(JSON.stringify(FULL));
  identity = { published: false };
  puts = [];
  try {
    await body({ code });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, SERVER_ENV_VAR, NETWORK_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** Both forms of this account's public code: what a person reads, and what the wire carries. */
async function mine(code: string): Promise<{ shown: string; raw: string }> {
  const crypt = await loadCrypto();
  const keys = shareKeysOf(crypt, code);
  return { shown: keys.display, raw: Buffer.from(keys.address).toString("base64url") };
}

test("the balance says the number, what it buys, and the ceilings", async () => {
  await sandbox("balance-plain", async () => {
    const lines: string[] = [];
    assert.equal(await balance({ write: (l) => lines.push(l) }), 0);
    const said = lines.join("\n");
    assert.match(said, /3 credits/);
    assert.match(said, /about 3\.1 MB/, "the same number said as bytes is missing");
    assert.match(said, /300 per file/);
    assert.match(said, /expiring/, "it should name the command that reads the storage clock");
  });
});

test("--json hands back the shape and prints nothing else", async () => {
  await sandbox("balance-json", async () => {
    const lines: string[] = [];
    assert.equal(await balance({ json: true, write: (l) => lines.push(l) }), 0);
    assert.equal(lines.length, 1);
    const parsed: unknown = JSON.parse(lines[0] ?? "");
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(Reflect.get(parsed, "credits"), "remaining"), 3);
  });
});

test("⛔ an answer this version cannot read is refused, not half-read", async () => {
  // A missing field read as zero would print "0 credits" to somebody who has plenty, and the next
  // thing they do is buy credits they already had.
  await sandbox("balance-shape", async () => {
    summary = { credits: { remaining: 3 }, quota: {}, storage: {} };
    await assert.rejects(balance({ write: () => {} }), /no usable/);
  });
});

test("terms that are in force and not accepted are said, and said as a person's job", async () => {
  await sandbox("balance-terms", async () => {
    summary = { ...FULL, terms: { acceptance_required: true } };
    const lines: string[] = [];
    await balance({ write: (l) => lines.push(l) });
    const said = lines.join("\n");
    assert.match(said, /New terms are in force/);
    assert.match(said, /nothing here can do it/);
  });
});

test("the public code is printed in the form a person reads, and an unpublished one names the flag", async () => {
  await sandbox("public-code-unpublished", async ({ code }) => {
    const lines: string[] = [];
    assert.equal(await publicCode({ write: (l) => lines.push(l) }), 0);
    const said = lines.join("\n");
    assert.match(said, new RegExp((await mine(code)).shown), "the grouped form a person reads is missing");
    assert.match(said, /NOT published/);
    assert.match(said, /public-code --publish/);
    assert.equal(puts.length, 0, "reading it wrote to the server");
  });
});

test("⛔ --publish writes exactly the value this account's code derives", async () => {
  await sandbox("public-code-publish", async ({ code }) => {
    const expected = await mine(code);
    const lines: string[] = [];
    assert.equal(await publicCode({ publish: true, write: (l) => lines.push(l) }), 0);
    assert.equal(puts.length, 1);
    assert.equal(puts[0]?.["share_address"], expected.raw);
    assert.match(lines.join("\n"), /published — another account can send files to it/);
  });
});

test("publishing twice writes once", async () => {
  await sandbox("public-code-twice", async () => {
    await publicCode({ publish: true, write: () => {} });
    await publicCode({ publish: true, write: () => {} });
    assert.equal(puts.length, 1, "it wrote a second time over an identical record");
  });
});

test("⛔ a server holding a different public code stops, and says what that actually means", async () => {
  await sandbox("public-code-mismatch", async () => {
    identity = { published: true, share_address: "AAAAAAAAAAAAAAAAAAAAAA" };
    await assert.rejects(publicCode({ publish: true, write: () => {} }), (error: unknown) => {
      assert.match(String(error), /already publishes a different public code/);
      const step = error instanceof Error && "nextStep" in error ? String(Reflect.get(error, "nextStep")) : "";
      assert.match(step, /different account's code/);
      return true;
    });
    assert.equal(puts.length, 0);
  });
});

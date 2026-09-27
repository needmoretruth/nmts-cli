// `nmts public-code list · new · revoke`, against the public-code doors kept by `fake-public-codes.ts`.
//
// ⛔ THE CODES THE FAKE HOLDS ARE THE ONES THIS KEY DERIVES, number by number, because the command
//    checks each one against its own derivation — a fake that held anything else would be testing
//    the mismatch refusal every time.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";

import { ServerError } from "../src/api.ts";
import { listCodes, newCode, revokeCodeCommand } from "../src/commands/public-code-manage.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { publicCodeRefusal } from "../src/public-code-refusals.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";
import { shareKeysAt } from "../src/share-codes.ts";
import { publicCodesState as state, resetPublicCodes, servePublicCodes, type FakeCode } from "./fake-public-codes.ts";
import { KEY } from "./fake-rows.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const server: Server = createServer((req, res) => {
  if (servePublicCodes(req.method ?? "GET", req.url ?? "", req, res)) return;
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such route" } }));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = server.address();
if (port === null || typeof port !== "object") throw new Error("no port");
const BASE = `http://127.0.0.1:${port.port}`;
after(() => server.close());

/** The code this key derives at `index`, both forms. */
async function at(code: string, index: number): Promise<{ shown: string; raw: string }> {
  const keys = shareKeysAt(await loadCrypto(), code, index);
  const out = { shown: keys.display, raw: Buffer.from(keys.address).toString("base64url") };
  keys.wipe();
  return out;
}

/** A row the fake lists, for the code this key derives at `index`. */
async function row(code: string, index: number, revoked: string | null = null): Promise<FakeCode> {
  return { index, address: (await at(code, index)).raw, created_at: "2026-09-10T00:00:00Z", revoked_at: revoked, sent: 2, received: 1, support: 0 };
}

async function sandbox(name: string, body: (code: string, lines: string[]) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  for (const [n, v] of [[CODE_ENV_VAR, code], [API_KEY_ENV_VAR, KEY], [SERVER_ENV_VAR, BASE], [NETWORK_ENV_VAR, "testnet"]] as const) {
    process.env[n] = v;
  }
  resetPublicCodes();
  try {
    await body(code, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, SERVER_ENV_VAR, NETWORK_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** Assert a refusal's two sentences. */
function refusedWith(message: string, next: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof NmtsError, `refused as ${String(error)}`);
    assert.equal(error.message, message);
    assert.equal(error.nextStep, next);
    return true;
  };
}

test("list: live codes first with the default marked, revoked after, and the two ceilings", async () => {
  await sandbox("pc-list", async (code, lines) => {
    state.codes = [await row(code, 0), await row(code, 1, "2026-09-20T08:00:00Z"), await row(code, 2)];
    state.madeToday = 2;
    assert.equal(await listCodes({ write: (l) => lines.push(l) }), 0);
    const [c0, c1, c2] = [await at(code, 0), await at(code, 1), await at(code, 2)];
    assert.deepEqual(lines, [
      `#0  ${c0.shown}  default  made 2026-09-10  sent 2 · received 1 · messages 0`,
      `#2  ${c2.shown}  made 2026-09-10  sent 2 · received 1 · messages 0`,
      `#1  ${c1.shown}  revoked 2026-09-20  sent 2 · received 1 · messages 0`,
      ``,
      `2 of 3 live · 2 of 10 made today (UTC)`,
    ]);
  });
});

test("⛔ list stops when the server holds a code this key does not derive at that number", async () => {
  await sandbox("pc-list-mismatch", async (code) => {
    state.codes = [await row(code, 0), { ...(await row(code, 1)), address: (await at(code, 0)).raw }];
    await assert.rejects(listCodes({ write: () => {} }), /already publishes a different public code/);
  });
});

test("new publishes the next number — past the highest ever, revoked ones included", async () => {
  await sandbox("pc-new", async (code, lines) => {
    state.codes = [await row(code, 0), await row(code, 1, "2026-09-20T00:00:00Z")];
    assert.equal(await newCode({ write: (l) => lines.push(l) }), 0);
    const c2 = await at(code, 2);
    assert.deepEqual(state.posts.map((p) => [p.index, p.address]), [[2, c2.raw]]);
    assert.equal(state.posts[0]?.revoke, undefined, "a plain new code revoked something");
    assert.deepEqual(lines, [`made public code #2  ${c2.shown}`]);
  });
});

test("new stops, and says why, when the server wants a number it also refuses as revoked", async () => {
  await sandbox("pc-new-walk", async (code) => {
    // An account erased and made again from the same key: code 0 published anew, code 1 revoked
    // before the erasure. The server wants 1 next and refuses it; walking to 2 is refused as not next.
    state.codes = [await row(code, 0)];
    state.revokedAddresses.add((await at(code, 1)).raw);
    await assert.rejects(newCode({ json: true, write: () => {} }), (error: unknown) => {
      assert.ok(error instanceof NmtsError && /wants public code #1 next, and refuses it as revoked/.test(error.message), String(error));
      return true;
    });
    assert.deepEqual(state.posts.map((p) => p.index), [1, 2], "it went back and forth instead of stopping");
  });
});

test("⛔ new --replace asks the revoke question, and revokes in the same request only on a yes", async () => {
  await sandbox("pc-replace", async (code, lines) => {
    state.codes = [await row(code, 0), await row(code, 1), await row(code, 2)];
    const c0 = await at(code, 0);
    let asked = "";
    const no = await newCode({ replace: "0", write: (l) => lines.push(l), readLine: async (q) => ((asked = q), "n") });
    assert.equal(no, 1);
    assert.equal(asked, `Revoke public code #0 (${c0.shown})? Nobody can send to it again, and nobody can bring it back. Files already received with it stay. [y/N] `);
    assert.equal(state.posts.length, 0, "a no still published");
    await assert.rejects(newCode({ replace: "0", write: () => {} }), (error: unknown) => {
      assert.ok(error instanceof NmtsError && error.exitCode === 5, "with nobody to ask it did not stop for a yes");
      return true;
    });
    lines.length = 0;
    assert.equal(await newCode({ replace: "0", yes: true, write: (l) => lines.push(l) }), 0);
    assert.deepEqual(state.posts[0]?.revoke, [0]);
    assert.deepEqual(lines, [`made public code #3  ${(await at(code, 3)).shown}`, `revoked #0  ${c0.shown}`]);
  });
});

test("the refusals say what happened and what to do, in the account's own numbers", async () => {
  await sandbox("pc-refusals", async (code) => {
    state.codes = [await row(code, 0), await row(code, 1), await row(code, 2)];
    await assert.rejects(
      newCode({ write: () => {} }),
      refusedWith("You already hold 3 live public codes.", "Revoke one first, or make the new one with --replace <number>."),
    );
    state.codes = [await row(code, 0)];
    state.madeToday = 10;
    await assert.rejects(newCode({ write: () => {} }), refusedWith("You have made 10 public codes today.", "Try again after 00:00 UTC."));
    state.madeToday = 0;
    state.refuseNext = { status: 409, code: "PLATFORM_REPLACE_ONLY" };
    await assert.rejects(
      newCode({ write: () => {} }),
      refusedWith("This account holds one public code, so a new one replaces it.", "Use --replace 0."),
    );
  });
});

test("revoke: one code, after a yes; never the last live one", async () => {
  await sandbox("pc-revoke", async (code, lines) => {
    state.codes = [await row(code, 0), await row(code, 1)];
    assert.equal(await revokeCodeCommand("1", { write: (l) => lines.push(l), readLine: async () => "y" }), 0);
    assert.deepEqual(state.revokes, [1]);
    assert.deepEqual(lines, [`revoked public code #1  ${(await at(code, 1)).shown}`]);
    await assert.rejects(
      revokeCodeCommand("0", { yes: true, write: () => {} }),
      refusedWith("That is your last live public code.", "Make a new one first: nmts public-code new --replace 0"),
    );
    assert.deepEqual(state.revokes, [1], "the last live code was sent to be revoked");
    await assert.rejects(revokeCodeCommand("x", { write: () => {} }), /takes a public code's number/);
  });
});

test("a refusal from the server maps to the same sentences, and anything else passes through", () => {
  const refusal = (status: number, code: string): ServerError => new ServerError(status, { code, message: "m" }, null);
  const last = publicCodeRefusal(refusal(409, "LAST_LIVE_CODE"), { replace: 4 });
  assert.ok(last instanceof NmtsError);
  assert.equal(last.message, "That is your last live public code.");
  assert.equal(last.nextStep, "Make a new one first: nmts public-code new --replace 4");
  const gone = publicCodeRefusal(refusal(410, "PUBLIC_CODE_REVOKED"));
  assert.ok(gone instanceof NmtsError);
  assert.equal(gone.message, "Its owner has revoked that public code.");
  assert.equal(gone.nextStep, "Ask them for the code they use now.");
  const other = refusal(500, "INTERNAL");
  assert.equal(publicCodeRefusal(other), other);
});

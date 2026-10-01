// `nmts create` with a one-time pass in `NMTS_AGENT_PASS` (D19g ⑥), against a real local server.
//
// ⛔ EACH TEST NAMES THE DEFECT IT CATCHES: a key sent to the server, a key not kept, a key kept
//    where another account's already was, a refusal that leaves a file for an account that does
//    not exist, a doubt that deletes the only copy, a secret on the screen.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { create } from "../src/commands/create.ts";
import { credentialsPath, testConfigDir, writeCredentials } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateCode } from "./helpers.ts";

/** ⛔ Assembled rather than written out, so nothing here reads as a credential to a scanner. */
const PASS = ["nmtsp", "P".repeat(43)].join("_");
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "y".repeat(43);

let refuseCreateWith: string | null = null;
let dropOnCreate = false;
let created: Record<string, unknown> | null = null;
let minted: Record<string, unknown> | null = null;
let calls: string[] = [];
let base = "";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push(`${method} ${path}`);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let raw = "";
  req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
  req.on("end", () => {
    const body: unknown = raw === "" ? null : JSON.parse(raw);
    if (method === "POST" && path === "/v1/accounts") {
      created = isRecord(body) ? { ...body } : null;
      if (dropOnCreate) return req.socket.destroy();
      if (refuseCreateWith !== null) {
        return send(403, { error: { code: refuseCreateWith, message: "refused by the test" } });
      }
      return send(201, {
        account: { account_id: created?.["account_id"], kdf_version: 3, status: "active", created_at: "2026-10-01T00:00:00Z" },
      });
    }
    if (method === "POST" && path === "/v1/account/api-keys/by-code") {
      minted = isRecord(body) ? { ...body } : null;
      return send(201, { key: KEY, key_id: "Abcdefghijkl", scopes: 7, expires_at: "2026-12-30T00:00:00Z" });
    }
    send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

const NAMES = ["NMTS_CONFIG_DIR", "NMTS_AGENT_PASS", "NMTS_PASSPHRASE", "NMTS_API_KEY"] as const;

async function withPass(name: string, body: (lines: string[]) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = NAMES.map((n) => [n, process.env[n]] as const);
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env["NMTS_AGENT_PASS"] = PASS;
  delete process.env["NMTS_PASSPHRASE"];
  delete process.env["NMTS_API_KEY"];
  refuseCreateWith = null;
  dropOnCreate = false;
  created = null;
  minted = null;
  calls = [];
  try {
    await body([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of before) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

function kept(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(credentialsPath(), "utf8"));
  assert.ok(isRecord(parsed));
  return parsed;
}

test("⛔ the pass makes the account the kept key derives, and an API key lands beside it", async () => {
  await withPass("pass-walk", async (lines) => {
    assert.equal(await create({ server: base, network: "testnet", write: (l) => lines.push(l) }), 0);

    assert.equal(created?.["agent_pass"], PASS, "the pass did not reach the account door");
    const stored = kept();
    const code = stored["accountCode"];
    assert.equal(typeof code, "string");
    const identity = await identityOf(String(code));
    assert.equal(created?.["account_id"], identity.accountId, "the server was told an id the kept key does not derive");
    assert.equal(minted?.["account_id"], identity.accountId);
    assert.equal(minted?.["scopes"], 7);
    assert.equal(stored["apiKey"], KEY);
    assert.equal(statSync(credentialsPath()).mode & 0o777, 0o600);

    const text = lines.join("\n");
    assert.match(text, /nmts trial apply/);
    for (const secret of [String(code), KEY, PASS]) {
      assert.ok(!text.includes(secret), "a secret reached the screen");
    }
    assert.ok(!JSON.stringify(created).includes(String(code)), "the NMTS key itself was sent");
  });
});

test("⛔ a key this machine already keeps is never replaced, and the pass is not spent", async () => {
  await withPass("pass-taken", async () => {
    writeCredentials({ accountCode: await generateCode(), server: base, network: "testnet" });
    const before = readFileSync(credentialsPath(), "utf8");
    await assert.rejects(
      create({ server: base, network: "testnet", write: () => {} }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 4,
    );
    assert.equal(readFileSync(credentialsPath(), "utf8"), before);
    assert.deepEqual(calls, [], "a refused run still talked to the server");
  });
});

test("⛔ a pass the server refuses leaves nothing behind", async () => {
  await withPass("pass-refused", async () => {
    refuseCreateWith = "AGENT_PASS_INVALID";
    await assert.rejects(
      create({ server: base, network: "testnet", write: () => {} }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 4 && /mistyped, past its hour/u.test(error.message),
    );
    assert.equal(existsSync(credentialsPath()), false, "a key for an account that does not exist was kept");
  });
});

test("⛔ an answer that never came keeps the key", async () => {
  await withPass("pass-dropped", async () => {
    dropOnCreate = true;
    await assert.rejects(create({ server: base, network: "testnet", write: () => {} }), NmtsError);
    assert.equal(existsSync(credentialsPath()), true, "the only key to a maybe-account was deleted");
  });
});

test("⛔ a passphrase in the environment seals the key instead", async () => {
  await withPass("pass-sealed", async () => {
    process.env["NMTS_PASSPHRASE"] = "correct horse battery staple";
    assert.equal(await create({ server: base, network: "testnet", write: () => {} }), 0);
    const stored = kept();
    assert.equal(stored["accountCode"], undefined, "a sealed run kept the key in the clear");
    assert.ok(isRecord(stored["lockedCode"]));
  });
});

test("⛔ --json carries no secret", async () => {
  await withPass("pass-json", async (lines) => {
    assert.equal(await create({ server: base, network: "testnet", json: true, write: (l) => lines.push(l) }), 0);
    const answer: unknown = JSON.parse(lines.join(""));
    assert.ok(isRecord(answer));
    assert.equal(answer["credentials"], credentialsPath());
    const text = lines.join("");
    for (const secret of [String(kept()["accountCode"]), KEY, PASS]) assert.ok(!text.includes(secret));
  });
});

test("⛔ --out does not go with a pass, and nothing is created", async () => {
  await withPass("pass-out", async () => {
    await assert.rejects(
      create({ server: base, network: "testnet", out: "./somewhere.txt", write: () => {} }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
    );
    assert.deepEqual(calls, []);
  });
});

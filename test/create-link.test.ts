// `nmts create` with no key: what goes on the wire, what the person is shown, and what is left on
// this machine.
//
// ⛔ THE FAKE SERVER CHECKS THE PROOF OF WORK. A server that accepted any nonce would let a tool
//    that never hashed anything pass every test in this file — and the whole point of the door is
//    that the work was done. It sets one bit rather than twenty so the suite stays instant; the
//    DIFFICULTY comes from the server's own answer, which is the property that matters.
//
// ⛔ AND IT ROUTES BY PATH AND METHOD, like `create.test.ts`'s. A fake that answers anything lets
//    the wrong address pass — the defect `check:cli-routes` was written after.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { create } from "../src/commands/create.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";

/** 43 characters, the shape a real link id has. */
const LINK_ID = "L".repeat(43);

/** What the fake server will do next. Each test sets what it needs and nothing else. */
let bits = 1;
let statusAnswer = "done";
let refuseLinkWith: string | null = null;
/** What the tool asked an address for, and the nonce it did the work with. */
let asked: Record<string, unknown> | null = null;
let calls: string[] = [];
let base = "";

/** The same rule the server keeps: SHA-256 over challenge, account id and nonce, in order, nothing between. */
function leadingZeroBits(challenge: string, accountId: string, nonce: string): number {
  const digest = createHash("sha256").update(challenge).update(accountId).update(nonce).digest();
  let seen = 0;
  for (const byte of digest) {
    seen += Math.clz32(byte) - 24;
    if (byte !== 0) break;
  }
  return seen;
}

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push(`${method} ${path}`);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (method === "GET" && path === "/v1/accounts/registration-challenge") {
    return send(200, {
      challenge: "a-challenge-only-this-server-issued",
      difficulty_bits: bits,
      expires_at: "2026-09-05T00:02:00Z",
    });
  }
  if (method === "POST" && path === "/v1/accounts/registration-links") {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body: unknown = JSON.parse(raw);
      asked = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : null;
      if (refuseLinkWith !== null) {
        return send(409, { error: { code: refuseLinkWith, message: "refused by the test" } });
      }
      const challenge = String(asked?.["challenge"] ?? "");
      const nonce = String(asked?.["nonce"] ?? "");
      if (leadingZeroBits(challenge, String(asked?.["account_id"] ?? ""), nonce) < bits) {
        return send(400, { error: { code: "VALIDATION", message: "the work was not done" } });
      }
      send(201, {
        url: `https://nmts.me/register/${LINK_ID}`,
        expires_at: "2026-09-05T00:30:00Z",
      });
    });
    return;
  }
  if (method === "GET" && path === `/v1/accounts/registration-links/${LINK_ID}`) {
    return send(200, { status: statusAnswer });
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

/**
 * A run with NO API KEY anywhere — which is what makes `create` take this path at all.
 *
 * ⛔ The environment variable is REMOVED rather than blanked, because a blank one and an absent one
 *    are not the same question for `resolveApiKey`, and the path being tested is the absent one.
 */
async function withNoKey(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  delete process.env[API_KEY_ENV_VAR];
  bits = 1;
  statusAnswer = "done";
  refuseLinkWith = null;
  asked = null;
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

/** ⛔ Found by the ENGINE's parser, not by a shape — a check symbol may be punctuation. */
async function printedCode(lines: string[]): Promise<string> {
  const found: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 20 || line.includes(" ")) continue;
    try {
      await identityOf(line);
      found.push(line);
    } catch {
      // Not a code. That is most lines.
    }
  }
  assert.equal(found.length, 1, `expected exactly one account code in the output, got ${found.length}`);
  return found[0] as string;
}

// ── The walk ────────────────────────────────────────────────────────────────────────────────

/// ⛔ Fails if any step of the flow stops carrying the code this run made: the address claimed for
/// some other id, the code printed but never claimed, the wait that never notices.
test("⛔ with no key: the work is done, the address is printed, and it is for THIS code", async () => {
  await withNoKey("create-link-walk", async () => {
    const out = collect();
    const exit = await create({ server: base, network: "testnet", write: out.write });
    assert.equal(exit, 0);

    // The three doors, in the one order that can work.
    assert.deepEqual(calls.slice(0, 2), [
      "GET /v1/accounts/registration-challenge",
      "POST /v1/accounts/registration-links",
    ]);
    assert.ok(
      calls.includes(`GET /v1/accounts/registration-links/${LINK_ID}`),
      "nothing ever asked whether a person had finished",
    );

    const code = await printedCode(out.lines);
    assert.equal(asked?.["account_id"], (await identityOf(code)).accountId);
    // ⛔ THE CODE ITSELF NEVER LEFT. Not as a field, not inside another one.
    assert.ok(!JSON.stringify(asked).includes(code), "the account code was sent to the server");

    const text = out.lines.join("\n");
    assert.ok(text.includes(`https://nmts.me/register/${LINK_ID}`), "no address was printed");
    assert.match(text, /Registered\./u);
    // The next step: a key, which this machine makes from the code it already holds.
    assert.match(text, /key new/u);
  });
});

/// ⛔ Catches the nonce being sent without the hashing — a server that checks would refuse it, and
/// this asserts the CLIENT computed something that satisfies the difficulty the SERVER named.
test("⛔ the nonce satisfies the difficulty the server asked for, not one this tool chose", async () => {
  await withNoKey("create-link-work", async () => {
    bits = 8;
    const out = collect();
    await create({ server: base, network: "testnet", noWait: true, write: out.write });
    const challenge = String(asked?.["challenge"] ?? "");
    const nonce = String(asked?.["nonce"] ?? "");
    assert.ok(nonce.length > 0, "no nonce was sent");
    assert.ok(leadingZeroBits(challenge, String(asked?.["account_id"] ?? ""), nonce) >= 8, "the work does not meet the server's bar");
  });
});

/// ⛔ Catches `--no-wait` waiting anyway (an agent's run would hang for half an hour), and catches
/// it printing an address with no way to find out what happened to it.
test("⛔ --no-wait prints the address and names the route that says what happened", async () => {
  await withNoKey("create-link-nowait", async () => {
    const out = collect();
    const exit = await create({ server: base, network: "testnet", noWait: true, write: out.write });
    assert.equal(exit, 0);
    assert.ok(
      !calls.some((c) => c.startsWith("GET /v1/accounts/registration-links/")),
      "--no-wait waited",
    );
    assert.ok(
      out.lines.join("\n").includes(`${base}/v1/accounts/registration-links/${LINK_ID}`),
      "an agent was left with no way to poll",
    );
  });
});

// ── What a program is handed ────────────────────────────────────────────────────────────────

/// ⛔ The rule the key path already keeps, on the path that did not exist when it was written:
/// machine-readable output carries the PATH and never the code.
test("⛔ --json needs --out, and its output names the file rather than the code", async () => {
  await withNoKey("create-link-json", async (dir) => {
    const refused = await create({ server: base, network: "testnet", json: true, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(refused instanceof NmtsError, "--json handed the account code to a program");
    assert.equal(refused.exitCode, 2);
    assert.equal(asked, null, "an address was claimed by a run that then refused to hand it over");

    const target = join(dir, "code.txt");
    const out = collect();
    const exit = await create({
      server: base,
      network: "testnet",
      json: true,
      out: target,
      write: out.write,
    });
    assert.equal(exit, 0);
    assert.equal(out.lines.length, 1, "machine-readable output is one object");
    const answer: unknown = JSON.parse(out.lines[0] as string);
    const fields = answer as Record<string, unknown>;
    assert.equal(fields["url"], `https://nmts.me/register/${LINK_ID}`);
    assert.equal(fields["code_file"], target);
    assert.equal(fields["status_url"], `${base}/v1/accounts/registration-links/${LINK_ID}`);
    const written = readFileSync(target, "utf8").trim();
    assert.ok(!out.lines[0]?.includes(written), "the account code went into the output");
    // The file holds a code the engine accepts, and it is the one the address is for.
    assert.equal(fields["expires_at"], "2026-09-05T00:30:00Z");
    assert.equal(asked?.["account_id"], (await identityOf(written)).accountId);
  });
});

/// ⛔ THE FILE IS WRITTEN BEFORE THE ADDRESS IS ASKED FOR. A full disk must fail while there is
/// nothing to lose — and when the server refuses afterwards the file STAYS, because nothing was
/// created and the code in it is simply one nobody registered.
test("⛔ the code file exists even when the address is refused", async () => {
  await withNoKey("create-link-file-first", async (dir) => {
    refuseLinkWith = "ACCOUNT_EXISTS";
    const target = join(dir, "code.txt");
    const failed = await create({
      server: base,
      network: "testnet",
      out: target,
      write: () => {},
    }).then(() => null, (error: unknown) => error);
    assert.ok(failed instanceof Error, "a refused address was reported as success");
    assert.ok(existsSync(target), "the code was made and then lost");
  });
});

// ── When nobody comes ───────────────────────────────────────────────────────────────────────

/// ⛔ Catches the wait treating "expired" as "keep waiting" — half an hour of a run that can no
/// longer end well — and catches it reporting a person's absence as success.
test("⛔ an address nobody opened ends the run, and says what to do", async () => {
  await withNoKey("create-link-expired", async () => {
    statusAnswer = "expired";
    const failed = await create({ server: base, network: "testnet", write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failed instanceof NmtsError, "nobody came and the run reported success");
    // 5 — waiting on a person, not a fault and not a malformed command line.
    assert.equal(failed.exitCode, 5);
    assert.match(String(failed.nextStep), /again/u);
  });
});

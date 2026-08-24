// The MCP layer, driven the way a client drives it: newline-delimited JSON-RPC in, the same out.
//
// ⛔ THE ONE THING THAT MUST NEVER BREAK is that stdout carries protocol and nothing else. A stray
//    line there is a parse error at the client and every tool silently disappears, so it is tested
//    directly rather than trusted to review.

import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { handle, serve, PROTOCOL_VERSIONS, type ToolDefinition } from "../src/mcp.ts";
import { destinationFor } from "../src/commands/mcp.ts";
import { NmtsError } from "../src/errors.ts";
import { PRODUCT_NAME, VERSION } from "../src/product.ts";

// ⛔ TAKEN FROM THE PROGRAM, NOT TYPED AGAIN. A version written here as a literal is a third
//    copy of a number that already lives in two places, and the day it goes stale this test
//    fails for a reason that has nothing to do with what it is testing.
const INFO = { name: PRODUCT_NAME, version: VERSION };

/**
 * A tool that spends unless it is told to hold back — the shape every paid tool here has.
 *
 * ⛔ It reports what it SAW, not what it was asked, so the test below can tell "refused" from
 *    "ran the paid branch". Reading `dry_run` with `=== true` is deliberate: it is what the real
 *    tools do, and the whole point is that the transport must never let a string reach it.
 */
const spender: ToolDefinition = {
  name: "spender",
  description: "would spend unless held back",
  inputSchema: {
    type: "object",
    properties: { file: { type: "string" }, dry_run: { type: "boolean" } },
    required: ["file"],
    additionalProperties: false,
  },
  async run(args) {
    return args["dry_run"] === true ? "priced only" : "SPENT";
  },
};

const echo: ToolDefinition = {
  name: "echo",
  description: "give back what it was given",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
  async run(args) {
    return String(args["text"] ?? "");
  },
};

const angry: ToolDefinition = {
  name: "angry",
  description: "always fails",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run() {
    throw new NmtsError("nothing was written");
  },
};

test("initialize answers with a version both sides know", async () => {
  for (const asked of PROTOCOL_VERSIONS) {
    const out = await handle(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: asked } },
      [echo],
      INFO,
    );
    const result = (out as { result: Record<string, unknown> }).result;
    assert.equal(result["protocolVersion"], asked, "a version we know must be answered with itself");
  }
});

test("⛔ a version we do not know is answered with one we do, not echoed back", async () => {
  const out = await handle(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
    [echo],
    INFO,
  );
  const version = (out as { result: Record<string, unknown> }).result["protocolVersion"];
  assert.equal(version, PROTOCOL_VERSIONS[0], "guessing that an unknown version is compatible half-works");
});

test("⛔ a notification gets no answer at all — sending one would be a protocol error", async () => {
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, [echo], INFO), null);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/somethingNew" }, [echo], INFO), null);
});

test("tools/list names every tool with its schema", async () => {
  const out = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, [echo, angry], INFO);
  const tools = (out as { result: { tools: { name: string; inputSchema: unknown }[] } }).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ["echo", "angry"]);
  assert.ok(tools.every((t) => typeof t.inputSchema === "object" && t.inputSchema !== null));
});

test("tools/call runs the tool and returns its text", async () => {
  const out = await handle(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hello" } } },
    [echo],
    INFO,
  );
  const result = (out as { result: { content: { text: string }[] } }).result;
  assert.equal(result.content[0]?.text, "hello");
});

test("⛔ a tool that fails is a failed TOOL, not a failed session", async () => {
  const out = await handle(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "angry" } },
    [angry],
    INFO,
  );
  const body = out as { result?: { isError?: boolean; content: { text: string }[] }; error?: unknown };
  assert.equal(body.error, undefined, "a broken tool must not look to the client like a broken server");
  assert.equal(body.result?.isError, true);
  assert.match(body.result?.content[0]?.text ?? "", /nothing was written/);
});

test("an unknown tool is an error the model can act on", async () => {
  const out = await handle(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } },
    [echo],
    INFO,
  );
  assert.match(String((out as { error: { message: string } }).error.message), /no tool named nope/);
});

test("⛔ a garbled line does not end the session — the next request still works", async () => {
  const said: string[] = [];
  await serve({
    input: Readable.from([
      "not json\n",
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`,
      "\n",
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "still here" } } })}\n`,
    ]),
    output: (line) => said.push(line),
    tools: [echo],
    info: INFO,
  });
  assert.equal(said.length, 3, "one parse error, one ping, one call — and nothing for the blank line");
  assert.match(said[0] ?? "", /invalid JSON/);
  assert.match(said[2] ?? "", /still here/);
});

test("⛔ every line put on the wire is one JSON object — nothing else may go there", async () => {
  const said: string[] = [];
  await serve({
    input: Readable.from([
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
    ]),
    output: (line) => said.push(line),
    tools: [echo],
    info: INFO,
  });
  assert.equal(said.length, 2, "the notification must not have been answered");
  for (const line of said) {
    assert.doesNotMatch(line, /\n/, "a protocol message may not carry a newline");
    const parsed: unknown = JSON.parse(line);
    assert.equal((parsed as { jsonrpc: string }).jsonrpc, "2.0");
  }
});

// ── WHERE FETCHED FILES LAND ────────────────────────────────────────────────────────────────
// ⛔ THE SEPARATOR IS NOT `/`. A first version of these two tests wrote `/` by hand and passed on
//    Linux and macOS while failing on Windows, where `resolve` answers in backslashes — the three
//    operating systems this repository's CI runs is what caught it. Build every expected path the
//    way the code does, from `join`/`sep`, and the test speaks whatever platform it is on.
const ROOT = join(tmpdir(), "nmts-mcp-test");

test("⛔ a name that tries to climb out lands INSIDE anyway, or is refused — never outside", async () => {
  // ⛔ The property is not "these are rejected". A file in somebody's drive may legitimately be
  //    called `../../etc/passwd`, and refusing to fetch it would be a bug. What must hold is that
  //    it cannot become a path on THIS disk outside the chosen directory: the climb is stripped,
  //    and anything with no usable last segment is refused.
  const root = resolve(ROOT);
  for (const climbing of ["../../etc/passwd", "/etc/passwd", "..", ".", "sub/../../../out", "..\\..\\win"]) {
    let landed: string | null = null;
    try {
      landed = destinationFor(root, climbing);
    } catch (e) {
      assert.ok(e instanceof NmtsError, `${climbing} failed for the wrong reason`);
      continue;
    }
    assert.ok(
      landed.startsWith(root + sep) && landed !== root,
      `${climbing} would be written to ${landed}, which is outside ${root}`,
    );
  }
});

test("an ordinary name lands under the chosen directory, keeping only its last segment", () => {
  assert.equal(destinationFor(ROOT, "photos/beach.jpg"), join(ROOT, "beach.jpg"));
  assert.equal(destinationFor(ROOT, "notes.txt"), join(ROOT, "notes.txt"));
});

// ── THE SEAM ────────────────────────────────────────────────────────────────────────────────
//
// The protocol layer and the commands each have their own tests. What nothing covered is the
// join between them: whether a tool really reads the account, and whether anything that is not a
// protocol message reaches stdout while it does.
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { after } from "node:test";

import { mcp } from "../src/commands/mcp.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, sealFile, sealFileList , grantConsents} from "./helpers.ts";

let seamManifest: unknown = { state: "absent" };
let seamParts: unknown = { size: 0, parts: [] };
let seamBlobs = new Map<string, Uint8Array>();

const seam: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest")) return json(200, seamManifest);
  if (url.includes("/parts")) return json(200, seamParts);
  const blob = url.match(/\/v1\/blobs\/(.+)$/);
  if (blob) {
    const bytes = seamBlobs.get(decodeURIComponent(blob[1] ?? ""));
    if (bytes === undefined) return json(404, { error: { code: "NOT_FOUND", message: "no such blob" } });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(Buffer.from(bytes));
  }
  json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => seam.listen(0, "127.0.0.1", resolve));
const seamAddress = seam.address();
if (seamAddress === null || typeof seamAddress !== "object") throw new Error("seam server did not bind");
const SEAM_BASE = `http://127.0.0.1:${seamAddress.port}`;
after(() => seam.close());

test("a tool really reads the account and writes the file, and stdout stays clean", async () => {
  const dir = testConfigDir("mcp-seam");
  const outDir = join(dir, "out");
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
    agg: process.env[AGGREGATOR_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  // ⛔ These suites hand the code in through the environment, which asks once. The agreement is
  //    tested in consent.test.ts and cli.test.ts; here it would only stop the test at exit 5.
  grantConsents(dir, "plain-env", "spend");
  process.env[AGGREGATOR_ENV_VAR] = SEAM_BASE;
  process.env[API_KEY_ENV_VAR] = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
  try {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;

    const plaintext = new Uint8Array(700).map((_, i) => i % 253);
    const sealed = await sealFile(code, [plaintext]);
    const item: ManifestEntry = {
      id: "99999999-8888-7777-6666-555555555555",
      parentId: null,
      kind: 1,
      name: "report.bin",
      size: plaintext.length,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      dekWrapped: sealed.dekWrapped,
      contentHashCt: sealed.contentHashCt,
    };
    seamManifest = {
      state: "present",
      seq: 1,
      ct: await sealFileList(code, await encodeManifest([item], 1)),
      updated_at: "2026-08-23T00:00:00Z",
    };
    seamParts = {
      size: plaintext.length,
      parts: sealed.parts.map((p, i) => ({
        part_index: i,
        storage_kind: 0,
        network: 0,
        blob_id: p.blobId,
        sealed_len: p.sealed.length,
        owner_kind: 0,
        expiry_epoch: 100,
      })),
    };
    seamBlobs = new Map(sealed.parts.map((p) => [p.blobId, p.sealed]));

    const wire: string[] = [];
    const notes: string[] = [];
    await mcp({
      server: SEAM_BASE,
      network: "testnet",
      out: outDir,
      input: Readable.from([
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nmts_list", arguments: {} } })}\n`,
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nmts_get", arguments: { path: "report.bin" } } })}\n`,
      ]),
      output: (line) => wire.push(line),
      note: (line) => notes.push(line),
    });

    // ⛔ Everything a person reads went the other way; the wire carries two protocol lines.
    assert.equal(wire.length, 2);
    assert.ok(notes.length > 0, "somebody starting this by hand must be told what it is serving");
    for (const line of wire) assert.equal((JSON.parse(line) as { jsonrpc: string }).jsonrpc, "2.0");

    const listed = JSON.parse((JSON.parse(wire[0] ?? "{}") as { result: { content: { text: string }[] } }).result.content[0]?.text ?? "{}") as {
      entries: { path: string }[];
    };
    assert.deepEqual(listed.entries.map((e) => e.path), ["report.bin"]);

    const fetched = JSON.parse((JSON.parse(wire[1] ?? "{}") as { result: { content: { text: string }[] } }).result.content[0]?.text ?? "{}") as {
      writtenTo: string;
    };
    assert.equal(fetched.writtenTo, join(outDir, "report.bin"));
    assert.deepEqual(new Uint8Array(readFileSync(fetched.writtenTo)), plaintext);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
      [API_KEY_ENV_VAR, before.key],
      [AGGREGATOR_ENV_VAR, before.agg],
    ] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
});

test('⛔ a boolean sent as a string is refused — it does not fall through to the paid branch', async () => {
  // The failure this holds: a model that sends `"dry_run": "true"` asked for a price. Before the
  // transport checked the declared schema, `=== true` read that string as false and the call
  // spent. A refusal is the only right answer — guessing which branch was meant is not this
  // layer's decision to make.
  const answer = await handle(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "spender", arguments: { file: "a", dry_run: "true" } },
    },
    [spender],
    INFO,
  );
  const result = answer?.["result"];
  assert.ok(result !== null && typeof result === "object");
  assert.equal(Reflect.get(result, "isError"), true, "the paid branch ran on a string");
  const text = JSON.stringify(Reflect.get(result, "content"));
  assert.match(text, /dry_run.*must be boolean/);
  assert.doesNotMatch(text, /SPENT/);
});

test("a correct call still reaches the tool", async () => {
  const answer = await handle(
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "spender", arguments: { file: "a", dry_run: true } },
    },
    [spender],
    INFO,
  );
  const result = answer?.["result"];
  assert.ok(result !== null && typeof result === "object");
  assert.equal(Reflect.get(result, "isError"), undefined);
  assert.match(JSON.stringify(Reflect.get(result, "content")), /priced only/);
});

// `x-nmts-client` — which program the NMTS server is talking to, for its public use-by-client
// counts. The command line says `cli`, its MCP server says `mcp`, and the value goes to the NMTS
// server only: a storage network read never carries it.
import { strict as assert } from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";

import { request } from "../src/api.ts";
import { CLIENT_HEADER, clientHeaderValue, identifyClient } from "../src/client-id.ts";
import { mcp } from "../src/commands/mcp.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { VERSION } from "../src/product.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFile, sealFileList } from "./helpers.ts";

/** Every request the fake received: its path, and what it said in `x-nmts-client`. */
const seen: { path: string; client: string | undefined }[] = [];
let manifest: unknown = { state: "absent" };
let parts: unknown = { size: 0, parts: [] };
let blobs = new Map<string, Uint8Array>();

const header = (req: IncomingMessage): string | undefined => {
  const v = req.headers[CLIENT_HEADER];
  return Array.isArray(v) ? v.join(",") : v;
};

const fake: Server = createServer((req, res) => {
  const url = req.url ?? "";
  seen.push({ path: url, client: header(req) });
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest")) return json(200, manifest);
  if (url.includes("/parts")) return json(200, parts);
  const blob = url.match(/\/v1\/blobs\/(.+)$/);
  if (blob) {
    const bytes = blobs.get(decodeURIComponent(blob[1] ?? ""));
    if (bytes === undefined) return json(404, { error: { code: "NOT_FOUND", message: "no such blob" } });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(Buffer.from(bytes));
  }
  json(200, { ok: true });
});
await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
const address = fake.address();
if (address === null || typeof address !== "object") throw new Error("fake server did not bind");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => fake.close());

test("the command line says `cli` and its own version on a request to the NMTS server", async () => {
  identifyClient("cli");
  seen.length = 0;
  await request(BASE, "/v1/anything", { token: "t" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.client, `cli/${VERSION}`);
  assert.equal(clientHeaderValue(), `cli/${VERSION}`);
});

test("a program that says it is the SDK sends `sdk` and the SDK's version", async () => {
  identifyClient("sdk", "0.16.0");
  try {
    seen.length = 0;
    await request(BASE, "/v1/anything");
    assert.equal(seen[0]?.client, "sdk/0.16.0");
  } finally {
    identifyClient("cli");
  }
});

test("the MCP server's requests say `mcp`, and the storage network never sees the header", async () => {
  const dir = testConfigDir("client-header-mcp");
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
  grantConsents(dir, "plain-env");
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
  try {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(300).map((_, i) => i % 251);
    const sealed = await sealFile(code, [plaintext]);
    const item: ManifestEntry = {
      id: "11111111-2222-3333-4444-555555555555",
      parentId: null,
      kind: 1,
      name: "note.bin",
      size: plaintext.length,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      dekWrapped: sealed.dekWrapped,
      contentHashCt: sealed.contentHashCt,
    };
    manifest = {
      state: "present",
      seq: 1,
      ct: await sealFileList(code, await encodeManifest([item], 1)),
      updated_at: "2026-10-21T00:00:00Z",
    };
    parts = {
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
    blobs = new Map(sealed.parts.map((p) => [p.blobId, p.sealed]));

    seen.length = 0;
    const wire: string[] = [];
    await mcp({
      server: BASE,
      network: "testnet",
      out: outDir,
      input: Readable.from([
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nmts_get", arguments: { path: "note.bin" } } })}\n`,
      ]),
      output: (line) => wire.push(line),
      note: () => {},
    });
    assert.equal(wire.length, 1);

    const toServer = seen.filter((r) => !r.path.startsWith("/v1/blobs/"));
    const toStorage = seen.filter((r) => r.path.startsWith("/v1/blobs/"));
    assert.ok(toServer.length > 0, "the server was asked for the file list");
    for (const r of toServer) assert.equal(r.client, `mcp/${VERSION}`, r.path);
    assert.ok(toStorage.length > 0, "the file was read from the storage network");
    for (const r of toStorage) assert.equal(r.client, undefined, `${r.path} must not carry ${CLIENT_HEADER}`);
  } finally {
    identifyClient("cli");
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

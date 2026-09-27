// `nmts link make` → `list` → `open` → `revoke`, against a local server that plays both the NMTS API
// and a Walrus aggregator. No fetch mocking: the wire and the crypto are what is tested.
//
// ⛔ THE PROPERTIES WORTH THE HARNESS: the secret is in the printed link and in no request; `open`
//    runs with no NMTS key and no API key and asks the server for the token only; a link that hides
//    the name still brings the file back at its real length (the sealed document keeps the size);
//    and once the link is cut, `open` is refused.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { link } from "../src/commands/link.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFile, sealFileList } from "./helpers.ts";

const ITEM_ID = "3f2b1a90-0000-4000-8000-000000000002";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const REAL = new TextEncoder().encode("the contents behind a public link");

let manifestBody: unknown = { state: "absent" };
let row: Record<string, unknown> | null = null;
let cut = false;
let partsBody: { size: number; parts: unknown[] } = { size: 0, parts: [] };
let blobs = new Map<string, Uint8Array>();
const calls: string[] = [];
const bodies: string[] = [];

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  calls.push(`${req.method} ${url} ${req.headers.authorization === undefined ? "anon" : "auth"}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let text = "";
  req.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
  req.on("end", () => {
    bodies.push(text);
    if (url.startsWith("/v1/manifest")) return send(200, manifestBody);
    if (req.method === "POST" && url === "/v1/share-links") {
      row = JSON.parse(text) as Record<string, unknown>;
      return send(201, { link_id: TOKEN, created_at: "2026-09-26T00:00:00Z", expires_at: row["expires_at"] });
    }
    if (req.method === "GET" && url.startsWith("/v1/share-links?item_id=")) {
      if (row === null) return send(200, { links: [] });
      return send(200, {
        links: [
          {
            link_id: TOKEN,
            item_id: ITEM_ID,
            owner_secret: row["owner_secret"],
            disclosed_name: row["disclosed_name"],
            created_at: "2026-09-26T00:00:00Z",
            downloads: 0,
            ...(cut ? { revoked_at: "2026-09-26T01:00:00Z", revoked_by: "owner" } : {}),
          },
        ],
      });
    }
    if (req.method === "DELETE" && url === `/v1/share-links/${TOKEN}`) {
      cut = true;
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && url === `/v1/share-links/${TOKEN}`) {
      if (row === null) return send(404, { error: { code: "NOT_FOUND", message: "no such link" } });
      if (cut) return send(410, { error: { code: "LINK_GONE", message: "gone" } });
      return send(200, { link_id: TOKEN, wrapped: row["wrapped"], name: row["name"], hash: row["hash"], network: "testnet", ...partsBody });
    }
    const blob = url.match(/\/v1\/blobs\/(.+)$/);
    if (blob) {
      const bytes = blobs.get(decodeURIComponent(blob[1] ?? ""));
      if (bytes === undefined) return send(404, { error: { code: "NOT_FOUND", message: "no such blob" } });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(Buffer.from(bytes));
    }
    send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const net = { server: BASE, network: "testnet" };

test("a link hides the name, opens with no key at the real length, sends no secret, and stops once cut", async () => {
  const dir = testConfigDir("link-roundtrip");
  const before = { ...process.env };
  const cwd = process.cwd();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  grantConsents(dir, "plain-env", "share");
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = KEY;
  try {
    const owner = await generateCode();
    process.env[CODE_ENV_VAR] = owner;
    // The file is stored sealed from MORE bytes than it has: only the size in the link's document
    // takes that padding back off.
    const padded = new Uint8Array(REAL.length + 100);
    padded.set(REAL, 0);
    const sealed = await sealFile(owner, [padded], REAL.length);
    const [p0] = sealed.parts;
    assert.ok(p0);
    const item: ManifestEntry = {
      id: ITEM_ID,
      parentId: null,
      kind: 1,
      name: "secret-name.txt",
      size: REAL.length,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      dekWrapped: sealed.dekWrapped,
      contentHashCt: sealed.contentHashCt,
    };
    manifestBody = { state: "present", seq: 1, ct: await sealFileList(owner, await encodeManifest([item], 1)), updated_at: "2026-09-26T00:00:00Z" };
    partsBody = {
      size: p0.sealed.length,
      parts: [{ part_index: 0, storage_kind: 0, network: 0, blob_id: p0.blobId, patch_id: null, sealed_len: p0.sealed.length, owner_kind: 0, expiry_epoch: 90 }],
    };
    blobs = new Map([[p0.blobId, p0.sealed]]);

    const printed: string[] = [];
    const write = (line: string) => void printed.push(line);
    assert.equal(await link("make", "secret-name.txt", { ...net, write, hideName: true, expires: "30d" }), 0);
    const made = printed[0] ?? "";
    assert.match(made, new RegExp(`^${BASE}/l/${TOKEN}#[A-Za-z0-9_-]{43}$`));
    const secret = made.split("#")[1] ?? "";
    assert.ok(row);
    assert.equal(row["disclosed_name"], false);
    assert.equal(typeof row["expires_at"], "string");
    assert.ok(!bodies.some((b) => b.includes(secret)), "the link's secret was sent to the server");

    printed.length = 0;
    assert.equal(await link("list", "secret-name.txt", { ...net, write }), 0);
    assert.ok(printed.includes(`  ${made}`), `the list did not print the same link again: ${printed.join(" | ")}`);

    // A visitor: no NMTS key, no API key.
    delete process.env[CODE_ENV_VAR];
    delete process.env[API_KEY_ENV_VAR];
    process.chdir(dir);
    calls.length = 0;
    assert.equal(await link("open", made, { ...net, write }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, `nmts-link-${TOKEN}`))), REAL);
    assert.ok(
      calls.filter((c) => !c.includes("/v1/blobs/")).every((c) => c === `GET /v1/share-links/${TOKEN} anon`),
      `open asked the server for more than the token: ${calls.join(" | ")}`,
    );

    process.env[CODE_ENV_VAR] = owner;
    process.env[API_KEY_ENV_VAR] = KEY;
    assert.equal(await link("revoke", TOKEN, { ...net, write }), 0);
    const err = await link("open", made, { ...net, write, out: join(dir, "again") }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof NmtsError && /has been cut/.test(err.message), String(err));
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, AGGREGATOR_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
});

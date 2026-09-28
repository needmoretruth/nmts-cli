// `nmts links` → `links revoke-all`, against a local server that plays the file list and the link
// doors (`fake-links.ts`). No fetch mocking: the wire and the crypto are what is tested.
//
// ⛔ THE PROPERTIES WORTH THE HARNESS: every live link across the account's files is listed whole,
//    each beside the path this machine read from the sealed file list (the server names files by id
//    only); `revoke-all` is one request and reports how many it cut; asking again cuts none.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";

import { link } from "../src/commands/link.ts";
import { links } from "../src/commands/links.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { linkState, resetLinks, serveLinks } from "./fake-links.ts";
import { generateCode, grantConsents, sealFile, sealFileList } from "./helpers.ts";

let manifestBody: unknown = { state: "absent" };
const calls: string[] = [];

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  calls.push(`${method} ${url}`);
  if (url.startsWith("/v1/manifest")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(manifestBody));
  }
  if (serveLinks(method, url, req, res)) return;
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such route" } }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const net = { server: BASE, network: "testnet" };

async function file(code: string, id: string, name: string): Promise<ManifestEntry> {
  const bytes = new TextEncoder().encode(`contents of ${name}`);
  const sealed = await sealFile(code, [bytes], bytes.length);
  return {
    id,
    parentId: null,
    kind: 1,
    name,
    size: bytes.length,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    dekWrapped: sealed.dekWrapped,
    contentHashCt: sealed.contentHashCt,
  };
}

test("every live link is listed with its file's path, and revoke-all cuts them in one request", async () => {
  const dir = testConfigDir("links-all");
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  grantConsents(dir, "plain-env", "share");
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  resetLinks();
  try {
    const owner = await generateCode();
    process.env[CODE_ENV_VAR] = owner;
    const a = await file(owner, "3f2b1a90-0000-4000-8000-00000000000a", "a.txt");
    const b = await file(owner, "3f2b1a90-0000-4000-8000-00000000000b", "b.txt");
    manifestBody = { state: "present", seq: 1, ct: await sealFileList(owner, await encodeManifest([a, b], 1)), updated_at: "2026-09-26T00:00:00Z" };

    const quiet = (): void => undefined;
    assert.equal(await link("make", "a.txt", { ...net, write: quiet }), 0);
    assert.equal(await link("make", "b.txt", { ...net, write: quiet }), 0);
    assert.equal(await link("make", "b.txt", { ...net, write: quiet }), 0);

    const printed: string[] = [];
    const write = (line: string) => void printed.push(line);
    assert.equal(await links(undefined, undefined, { ...net, write, json: true }), 0);
    const listed = JSON.parse(printed[0] ?? "{}") as { links: { id: string; path: string | null; link: string | null }[] };
    assert.deepEqual(
      listed.links.map((l) => [l.id, l.path]),
      [...linkState.rows].reverse().map((r) => [r.id, r.body["item_id"] === a.id ? "a.txt" : "b.txt"]),
    );
    for (const l of listed.links) assert.match(l.link ?? "", new RegExp(`^${BASE}/l/${l.id}#[A-Za-z0-9_-]{43}$`));

    printed.length = 0;
    assert.equal(await links(undefined, undefined, { ...net, write }), 0);
    assert.ok(printed.some((l) => l.includes("  a.txt  ")), `no line named a.txt: ${printed.join(" | ")}`);

    printed.length = 0;
    calls.length = 0;
    assert.equal(await links("revoke-all", undefined, { ...net, write }), 0);
    assert.deepEqual(printed, ["3 links cut"]);
    assert.deepEqual(calls, ["DELETE /v1/share-links"], "cutting all was more than one request");
    assert.ok(linkState.rows.every((r) => r.cut));

    printed.length = 0;
    assert.equal(await links("revoke-all", undefined, { ...net, write, json: true }), 0);
    assert.deepEqual(JSON.parse(printed[0] ?? "{}"), { cut: 0 }, "asking again cut something");

    printed.length = 0;
    assert.equal(await links(undefined, undefined, { ...net, write }), 0);
    assert.deepEqual(printed, ["No live public links."]);

    const err = await links("frob", undefined, { ...net, write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof NmtsError && err.exitCode === 2, String(err));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
});

// `nmts pull` — a folder, or a whole account, onto this machine.
//
// ⛔ THE PROPERTY THIS SUITE EXISTS FOR: one file that will not come back must not lose the ones
//    that did. A single `get` refuses rather than writing a half-right file, and that is right for
//    one file; applied to two hundred it would mean one unreadable file throws away every file
//    fetched before it, and somebody runs it again and loses them again.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { pull } from "../src/commands/pull.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFile, sealFileList } from "./helpers.ts";

let manifestBody: unknown = { state: "absent" };
const parts = new Map<string, unknown>();
const blobs = new Map<string, Uint8Array>();

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest")) return send(200, manifestBody);
  const asked = url.match(/\/v1\/items\/([^/]+)\/parts/);
  if (asked) {
    const body = parts.get(decodeURIComponent(asked[1] ?? ""));
    return body === undefined ? send(404, { error: { code: "NOT_FOUND", message: "no rows" } }) : send(200, body);
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
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("no port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

function folder(id: string, name: string, parentId: string | null = null): ManifestEntry {
  return { id, name, parentId, kind: 0, size: 0, createdAt: 1, updatedAt: 1 };
}

/** A real file: sealed, its bytes served as a blob, its rows served as parts. */
async function file(
  code: string,
  id: string,
  name: string,
  parentId: string | null,
  body: string,
): Promise<ManifestEntry> {
  const bytes = new TextEncoder().encode(body);
  const sealed = await sealFile(code, [bytes]);
  const only = sealed.parts[0];
  if (only === undefined) throw new Error("sealFile made no parts");
  blobs.set(id, only.sealed);
  parts.set(id, {
    size: only.sealed.length,
    parts: [{ part_index: 0, storage_kind: 0, network: 0, blob_id: id }],
  });
  return {
    id,
    name,
    parentId,
    kind: 1,
    size: bytes.length,
    createdAt: 1,
    updatedAt: 1,
    dekWrapped: sealed.dekWrapped,
    contentHashCt: sealed.contentHashCt,
  };
}

async function sandbox(name: string, body: (code: string, dir: string) => Promise<void>): Promise<void> {
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
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[NETWORK_ENV_VAR] = "testnet";
  parts.clear();
  blobs.clear();
  try {
    await body(code, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, SERVER_ENV_VAR, AGGREGATOR_ENV_VAR, NETWORK_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

async function serveList(code: string, entries: ManifestEntry[]): Promise<void> {
  manifestBody = {
    state: "present",
    seq: 1,
    ct: await sealFileList(code, await encodeManifest(entries, 1)),
    updated_at: "2026-08-24T00:00:00Z",
  };
}

test("a folder comes back with its shape", async () => {
  await sandbox("pull-shape", async (code, dir) => {
    const out = join(dir, "out");
    await serveList(code, [
      folder("f1", "notes"),
      folder("f2", "deep", "f1"),
      await file(code, "a", "top.txt", "f1", "one"),
      await file(code, "b", "under.txt", "f2", "two"),
      await file(code, "c", "elsewhere.txt", null, "three"),
    ]);
    const lines: string[] = [];
    assert.equal(await pull("notes", { out, write: (l) => lines.push(l) }), 0);
    assert.equal(readFileSync(join(out, "top.txt"), "utf8"), "one");
    assert.equal(readFileSync(join(out, "deep", "under.txt"), "utf8"), "two");
    assert.equal(existsSync(join(out, "elsewhere.txt")), false, "a file outside the folder came too");
  });
});

test("no folder named means the whole account", async () => {
  await sandbox("pull-all", async (code, dir) => {
    const out = join(dir, "out");
    await serveList(code, [
      folder("f1", "notes"),
      await file(code, "a", "top.txt", "f1", "one"),
      await file(code, "c", "root.txt", null, "three"),
    ]);
    assert.equal(await pull(undefined, { out, write: () => {} }), 0);
    assert.equal(readFileSync(join(out, "notes", "top.txt"), "utf8"), "one");
    assert.equal(readFileSync(join(out, "root.txt"), "utf8"), "three");
  });
});

test("⛔ one file that will not come back does not lose the others", async () => {
  await sandbox("pull-partial", async (code, dir) => {
    const out = join(dir, "out");
    const good = await file(code, "a", "good.txt", null, "kept");
    const bad = await file(code, "b", "bad.txt", null, "lost");
    blobs.delete("b"); // the storage network no longer has it
    const alsoGood = await file(code, "c", "also.txt", null, "kept too");
    await serveList(code, [good, bad, alsoGood]);

    const lines: string[] = [];
    // ⛔ Exit 1, because something failed — but the files that worked are on disk.
    assert.equal(await pull(undefined, { out, write: (l) => lines.push(l) }), 1);
    assert.equal(readFileSync(join(out, "good.txt"), "utf8"), "kept");
    assert.equal(readFileSync(join(out, "also.txt"), "utf8"), "kept too");
    assert.equal(existsSync(join(out, "bad.txt")), false, "a file that failed was written anyway");
    const said = lines.join(" ");
    assert.match(said, /bad\.txt/, "the one that failed is named");
    assert.match(said, /2 written/);
  });
});

test("files already there are skipped and counted, not replaced", async () => {
  await sandbox("pull-skip", async (code, dir) => {
    const out = join(dir, "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "a.txt"), "mine, from before");
    await serveList(code, [await file(code, "a", "a.txt", null, "theirs")]);

    const lines: string[] = [];
    assert.equal(await pull(undefined, { out, write: (l) => lines.push(l) }), 0);
    assert.equal(readFileSync(join(out, "a.txt"), "utf8"), "mine, from before", "it was overwritten");
    assert.match(lines.join(" "), /1 already there/);

    // ⛔ And --force is the only way past it, because that cannot be undone.
    assert.equal(await pull(undefined, { out, force: true, write: () => {} }), 0);
    assert.equal(readFileSync(join(out, "a.txt"), "utf8"), "theirs");
  });
});

test("⛔ a name that would climb out of the destination is refused", async () => {
  // Names in the sealed list are written by whoever holds the account. A name made of dots, or one
  // carrying a separator, must not be able to put a file somewhere nobody asked for.
  await sandbox("pull-escape", async (code, dir) => {
    const out = join(dir, "out");
    await serveList(code, [await file(code, "a", "..", null, "escapes")]);
    await assert.rejects(pull(undefined, { out, write: () => {} }), /cannot be written to a path/);
    assert.equal(existsSync(join(dir, "..")), true);
  });
});

test("a file the list holds no key for is reported, not silently missed", async () => {
  await sandbox("pull-nokey", async (code, dir) => {
    const out = join(dir, "out");
    const keyless = await file(code, "a", "keyless.txt", null, "x");
    delete keyless.dekWrapped;
    await serveList(code, [keyless, await file(code, "b", "fine.txt", null, "y")]);
    const lines: string[] = [];
    assert.equal(await pull(undefined, { out, write: (l) => lines.push(l) }), 1);
    assert.match(lines.join(" "), /keyless\.txt: the file list holds no key/);
    assert.equal(readFileSync(join(out, "fine.txt"), "utf8"), "y");
  });
});

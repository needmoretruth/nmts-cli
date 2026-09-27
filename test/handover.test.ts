// `nmts handover make` → `nmts handover open`, against a local server that plays both the NMTS API
// and a Walrus aggregator. No fetch mocking: the wire and the crypto are what is tested.
//
// ⛔ THE PROPERTY WORTH THE HARNESS: opening a handover file asks the NMTS server NOTHING and needs
//    no API key. The key is taken out of the environment before every open, every request the
//    recipient's run makes is recorded, and the only ones allowed are aggregator reads. The file
//    comes back byte for byte at the SENDER's length, out of two stored pieces — a quilt patch and a
//    whole blob sealed from more bytes than the file has.
//
// The other direction of the cross-program promise — a file the BROWSER made, opened here — is
// `handover-vectors.test.ts`.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { handover } from "../src/commands/handover.ts";
import { publicCode } from "../src/commands/public-code.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { loadCrypto } from "../src/crypto.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { shareKeysOf } from "../src/share.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { assertModeWhereEnforced, generateCode, grantConsents, sealFile, sealFileList } from "./helpers.ts";

const ITEM_ID = "3f2b1a90-0000-4000-8000-000000000001";
const REAL = new TextEncoder().encode("the contents that were handed over, outside NMTS");

let manifestBody: unknown = { state: "absent" };
let partsBody: unknown = { size: 0, parts: [] };
let recipientBody: unknown = null;
let blobs = new Map<string, Uint8Array>();
const calls: string[] = [];

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  calls.push(`${req.method} ${url}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest")) return send(200, manifestBody);
  if (url.startsWith("/v1/share-recipients/")) return recipientBody === null ? send(404, {}) : send(200, recipientBody);
  if (url.includes("/parts")) return send(200, partsBody);
  const blob = url.match(/\/v1\/blobs\/(?:by-quilt-patch-id\/)?(.+)$/);
  if (blob) {
    const bytes = blobs.get(decodeURIComponent(blob[1] ?? ""));
    if (bytes === undefined) return send(404, { error: { code: "NOT_FOUND", message: "no such blob" } });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(Buffer.from(bytes));
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const quiet = { write: (_line: string) => undefined };
const net = { server: BASE, network: "testnet" };

async function withSandbox(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  const cwd = process.cwd();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env", "share");
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = KEY;
  try {
    await body(dir);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, AGGREGATOR_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** Open as `code` with NO API key in the environment — the recipient's side needs none. */
async function openAs(code: string, file: string, options: Parameters<typeof handover>[2] = {}): Promise<number> {
  process.env[CODE_ENV_VAR] = code;
  delete process.env[API_KEY_ENV_VAR];
  try {
    return await handover("open", file, { ...net, ...quiet, ...options });
  } finally {
    process.env[API_KEY_ENV_VAR] = KEY;
  }
}

async function refusedWith(run: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(err instanceof NmtsError && pattern.test(err.message), String(err));
}

/**
 * The sender's drive: one file in two stored pieces — a quilt patch, then a whole blob sealed from
 * MORE bytes than the file has left.
 */
async function senderDrive(code: string): Promise<void> {
  const first = REAL.slice(0, 20);
  const padded = new Uint8Array(200);
  padded.set(REAL.slice(20), 0);
  const sealed = await sealFile(code, [first, padded], REAL.length);
  const item: ManifestEntry = {
    id: ITEM_ID,
    parentId: null,
    kind: 1,
    name: "handed.txt",
    size: REAL.length,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    dekWrapped: sealed.dekWrapped,
    contentHashCt: sealed.contentHashCt,
  };
  manifestBody = { state: "present", seq: 1, ct: await sealFileList(code, await encodeManifest([item], 1)), updated_at: "2026-09-23T00:00:00Z" };
  const [p0, p1] = sealed.parts;
  if (p0 === undefined || p1 === undefined) throw new Error("two pieces were sealed");
  partsBody = {
    size: p0.sealed.length + p1.sealed.length,
    parts: [
      { part_index: 0, storage_kind: 1, network: 0, blob_id: "quilt-q", patch_id: "patch-0", sealed_len: p0.sealed.length, owner_kind: 0, expiry_epoch: 90 },
      { part_index: 1, storage_kind: 0, network: 0, blob_id: p1.blobId, patch_id: null, sealed_len: p1.sealed.length, owner_kind: 0, expiry_epoch: 77 },
    ],
  };
  blobs = new Map([
    ["patch-0", p0.sealed],
    [p1.blobId, p1.sealed],
  ]);
}

test("a handover made to a public code file opens for its recipient with no API key, asking the NMTS server nothing", async () => {
  await withSandbox("handover-roundtrip", async (dir) => {
    const [sender, recipient, stranger] = [await generateCode(), await generateCode(), await generateCode()];
    const crypt = await loadCrypto();

    // The recipient's public code file, under its default name in the current directory.
    process.chdir(dir);
    process.env[CODE_ENV_VAR] = recipient;
    assert.equal(await publicCode({ ...quiet, save: true }), 0);
    const recipientKeys = shareKeysOf(crypt, recipient);
    const codeFile = join(dir, `nmts-public-code-${recipientKeys.display}.nmtscode`);
    recipientKeys.wipe();
    assert.ok(existsSync(codeFile), "the public code file was not written under its default name");
    await refusedWith(publicCode({ ...quiet, save: true, publish: true }), /one at a time/);

    const handoverFile = join(dir, "gift.nmtshandover");
    process.env[CODE_ENV_VAR] = sender;
    await senderDrive(sender);
    calls.length = 0;
    assert.equal(await handover("make", "handed.txt", { ...net, ...quiet, to: codeFile, out: handoverFile, yes: true }), 0);
    assert.ok(!calls.some((c) => c.includes("/v1/share-recipients/")), "a public code file was looked up on the server anyway");
    assert.ok(!calls.some((c) => c.startsWith("POST")), "the server was told about the handover");
    assertModeWhereEnforced(handoverFile, 0o600, "a handover file is written readable by its owner only");
    const text = readFileSync(handoverFile, "utf8");
    assert.ok(!text.includes("handed.txt"), "the file's name travels in the clear");

    // No --out: the sender's name, in the current directory.
    calls.length = 0;
    const lines: string[] = [];
    assert.equal(await openAs(recipient, handoverFile, { write: (l) => lines.push(l) }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "handed.txt"))), REAL);
    assert.deepEqual(
      calls.filter((c) => !c.startsWith("GET /v1/blobs/")),
      [],
      "opening a handover file reached the NMTS server",
    );
    assert.ok(calls.some((c) => c.includes("/v1/blobs/by-quilt-patch-id/patch-0")), "the quilt piece was not fetched by its patch id");
    const senderKeys = shareKeysOf(crypt, sender);
    assert.ok(lines.join("\n").includes(senderKeys.display), "the sender is named");
    senderKeys.wipe();

    // --out is the file to write, as for `receive`.
    const named = join(dir, "renamed.bin");
    assert.equal(await openAs(recipient, handoverFile, { out: named }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(named)), REAL);

    // Anybody else's NMTS key does not open it, and nothing is written.
    const elsewhere = join(dir, "elsewhere.txt");
    await refusedWith(openAs(stranger, handoverFile, { out: elsewhere }), /does not open with your NMTS key/);
    assert.equal(existsSync(elsewhere), false);
    // Nor does the recipient's own key on the other network.
    await refusedWith(openAs(recipient, handoverFile, { out: elsewhere, network: "mainnet" }), /other network/);
    // A file too large to be a handover file is refused before it is read.
    const huge = join(dir, "huge.nmtshandover");
    writeFileSync(huge, " ".repeat(1024 * 1024 + 1));
    await refusedWith(openAs(recipient, huge, { out: elsewhere }), /too large/);
  });
});

test("a handover to a typed public code looks the code up; without --yes it writes nothing and names every option to go ahead", async () => {
  await withSandbox("handover-typed", async (dir) => {
    const [sender, recipient] = [await generateCode(), await generateCode()];
    const crypt = await loadCrypto();
    const r = shareKeysOf(crypt, recipient);
    recipientBody = { share_public_key: Buffer.from(r.identity).toString("base64url") };
    const out = join(dir, "typed.nmtshandover");

    process.env[CODE_ENV_VAR] = sender;
    await senderDrive(sender);
    const lines: string[] = [];
    assert.equal(await handover("make", "handed.txt", { ...net, to: r.display, out, force: true, write: (l) => lines.push(l) }), 5);
    assert.equal(existsSync(out), false, "a handover file was written without --yes");
    const review = lines.join("\n");
    assert.match(review, /cannot be taken back/);
    assert.match(review, /Removing the file from your drive does not stop it/);
    const goAhead = lines.find((l) => l.includes("To go ahead")) ?? "";
    for (const part of ["--out", JSON.stringify(out), "--force", "--server", "--network", "--yes"]) {
      assert.ok(goAhead.includes(part), `the command to go ahead drops ${part}: ${goAhead}`);
    }

    calls.length = 0;
    assert.equal(await handover("make", "handed.txt", { ...net, ...quiet, to: r.display, out, yes: true }), 0);
    assert.ok(calls.some((c) => c.includes("/v1/share-recipients/")), "the typed code was not looked up");

    // An existing output file is refused before anything is asked of the server.
    calls.length = 0;
    await refusedWith(handover("make", "handed.txt", { ...net, ...quiet, to: r.display, out, yes: true }), /already exists/);
    assert.deepEqual(calls, [], "the server was asked something before the output was checked");

    const got = join(dir, "got.txt");
    assert.equal(await openAs(recipient, out, { out: got }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(got)), REAL);
    r.wipe();
    recipientBody = null;
  });
});

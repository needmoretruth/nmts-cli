// `nmts get` against a real local server that plays both parts: the NMTS API and a storage-network
// aggregator. No fetch mocking — what is being tested is the wire and the crypto.
//
// ⛔ EVERY FAILURE CASE ALSO ASSERTS THAT NOTHING WAS WRITTEN. A file on disk is a claim that it is
//    the file; a half-right one makes that claim silently, which is the whole reason `get` refuses.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { get } from "../src/commands/get.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, modesAreEnforced, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, sealFile, sealFileList, type SealedFile , grantConsents} from "./helpers.ts";

const ITEM_ID = "11111111-2222-3333-4444-555555555555";

/** What the fake NMTS + aggregator answers with, set per test. */
let manifestBody: unknown = { state: "absent" };
let partsBody: unknown = { size: 0, parts: [] };
let blobs = new Map<string, Uint8Array>();

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest")) return send(200, manifestBody);
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

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function withSandbox(name: string, body: (dir: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
    agg: process.env[AGGREGATOR_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  // ⛔ These suites hand the code in through the environment, which asks once. The agreement is
  //    tested in consent.test.ts and cli.test.ts; here it would only stop the test at exit 5.
  grantConsents(dir, "plain-env", "spend");
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = KEY;
  try {
    await body(dir);
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
}

function entry(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return {
    parentId: null,
    kind: 1,
    size: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

/** Put one file in front of the tool: the file list names it, the network holds its parts. */
async function serve(code: string, name: string, sealed: SealedFile, size: number, over: Partial<ManifestEntry> = {}): Promise<void> {
  const item = entry({
    id: ITEM_ID,
    name,
    size,
    dekWrapped: sealed.dekWrapped,
    contentHashCt: sealed.contentHashCt,
    ...over,
  });
  const body = await encodeManifest([item], 1);
  manifestBody = { state: "present", seq: 1, ct: await sealFileList(code, body), updated_at: "2026-08-23T00:00:00Z" };
  partsBody = {
    size,
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
}

test("one whole file comes back byte for byte, and the file it writes is not world-readable", async () => {
  await withSandbox("get-one", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(5000).map((_, i) => (i * 7) % 251);
    await serve(code, "notes.bin", await sealFile(code, [plaintext]), plaintext.length);
    const out = join(dir, "notes.bin");
    const said = collect();
    assert.equal(await get("notes.bin", { server: BASE, network: "testnet", out, write: said.write }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(out)), plaintext);
    if (modesAreEnforced()) assert.equal(statSync(out).mode & 0o077, 0, "the file others can read");
  });
});

test("a file split across parts, with the last one padded, comes back at its real size", async () => {
  await withSandbox("get-parts", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const a = new Uint8Array(3000).fill(1);
    const b = new Uint8Array(3000).fill(2);
    // The last part is sealed with 3000 bytes but only 1200 of them belong to the file.
    const size = a.length + 1200;
    await serve(code, "big.bin", await sealFile(code, [a, b], size), size);
    const out = join(dir, "big.bin");
    assert.equal(await get("big.bin", { server: BASE, network: "testnet", out, write: collect().write }), 0);
    const got = new Uint8Array(readFileSync(out));
    assert.equal(got.length, size);
    assert.deepEqual(got.subarray(0, 3000), a);
    assert.deepEqual(got.subarray(3000), b.subarray(0, 1200));
  });
});

test("⛔ bytes that are not the ones this account sealed are refused, and nothing is written", async () => {
  await withSandbox("get-tampered", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(1000).fill(9);
    const sealed = await sealFile(code, [plaintext]);
    await serve(code, "x.bin", sealed, plaintext.length);
    // Flip one byte of the stored stream. Every chunk is authenticated, so this cannot open.
    const stored = blobs.get(sealed.parts[0]!.blobId)!;
    stored[stored.length - 1] ^= 0xff;
    const out = join(dir, "x.bin");
    const failure = await get("x.bin", { server: BASE, network: "testnet", out, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "tampered bytes were accepted");
    assert.match(failure.message, /did not decrypt/);
    assert.equal(existsSync(out), false, "a file was written for a download that failed");
  });
});

test("⛔ a whole file that does not match its recorded hash is refused, and nothing is written", async () => {
  await withSandbox("get-hash", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(800).fill(3);
    const sealed = await sealFile(code, [plaintext]);
    // Seal a DIFFERENT file's hash beside the same bytes: everything decrypts, the file is wrong.
    const other = await sealFile(code, [new Uint8Array(800).fill(4)]);
    sealed.contentHashCt = other.contentHashCt;
    await serve(code, "y.bin", sealed, plaintext.length);
    const out = join(dir, "y.bin");
    const failure = await get("y.bin", { server: BASE, network: "testnet", out, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "a file that failed its own hash was written");
    assert.match(failure.message, /does not match the hash/);
    assert.equal(existsSync(out), false);
  });
});

test("⛔ parts that do not add up to the file the list describes are refused", async () => {
  await withSandbox("get-short", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(500).fill(5);
    // The list claims a bigger file than the stored parts hold.
    await serve(code, "z.bin", await sealFile(code, [plaintext], 500), 900);
    const out = join(dir, "z.bin");
    const failure = await get("z.bin", { server: BASE, network: "testnet", out, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "a short file was written as if it were whole");
    assert.equal(existsSync(out), false);
  });
});

test("⛔ a part on a storage network this version cannot read is refused before it is fetched", async () => {
  await withSandbox("get-network", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(100).fill(6);
    await serve(code, "w.bin", await sealFile(code, [plaintext]), plaintext.length);
    const body = partsBody as { parts: { network: number }[] };
    body.parts[0]!.network = 1; // another storage network — no reader here
    const out = join(dir, "w.bin");
    const failure = await get("w.bin", { server: BASE, network: "testnet", out, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.match(failure.message, /cannot read/);
    assert.equal(existsSync(out), false);
  });
});

test("⛔ it will not replace a file that is already there unless told to", async () => {
  await withSandbox("get-clobber", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(64).fill(7);
    await serve(code, "keep.bin", await sealFile(code, [plaintext]), plaintext.length);
    const out = join(dir, "keep.bin");
    writeFileSync(out, "mine\n");
    const failure = await get("keep.bin", { server: BASE, network: "testnet", out, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "an existing file was replaced without being asked");
    assert.match(failure.message, /already exists/);
    assert.equal(readFileSync(out, "utf8"), "mine\n");

    assert.equal(await get("keep.bin", { server: BASE, network: "testnet", out, force: true, write: collect().write }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(out)), plaintext);
  });
});

test("a path that names nothing says whether it is in the trash, a folder, or absent", async () => {
  await withSandbox("get-missing", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const items = [
      entry({ id: "t1", name: "gone.bin", deletedAt: 1 }),
      entry({ id: "d1", name: "folder", kind: 0 }),
    ];
    manifestBody = {
      state: "present",
      seq: 1,
      ct: await sealFileList(code, await encodeManifest(items, 1)),
      updated_at: "2026-08-23T00:00:00Z",
    };
    for (const [target, expected] of [
      ["gone.bin", /trash/],
      ["folder", /folder/],
      ["nothing.bin", /ls/],
    ] as const) {
      const failure = await get(target, { server: BASE, network: "testnet", out: join(dir, "o"), write: collect().write }).then(
        () => null,
        (e: unknown) => e,
      );
      assert.ok(failure instanceof NmtsError, `${target} did not fail`);
      assert.match(failure.nextStep ?? "", expected, `${target} was answered with the wrong reason`);
    }
  });
});

test("--json says where it wrote, how many parts, and whether the hash was checked", async () => {
  await withSandbox("get-json", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(120).fill(8);
    await serve(code, "j.bin", await sealFile(code, [plaintext]), plaintext.length);
    const out = join(dir, "j.bin");
    const said = collect();
    await get("j.bin", { server: BASE, network: "testnet", out, json: true, write: said.write });
    const view = JSON.parse(said.lines.join("")) as Record<string, unknown>;
    assert.equal(view["writtenTo"], out);
    assert.equal(view["bytes"], plaintext.length);
    assert.equal(view["parts"], 1);
    assert.equal(view["contentHashChecked"], true);
  });
});

test("a file with no recorded hash is written, and the missing check is said out loud", async () => {
  await withSandbox("get-nohash", async (dir) => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    const plaintext = new Uint8Array(90).fill(2);
    const sealed = await sealFile(code, [plaintext]);
    await serve(code, "n.bin", sealed, plaintext.length, { contentHashCt: undefined });
    const out = join(dir, "n.bin");
    const said = collect();
    assert.equal(await get("n.bin", { server: BASE, network: "testnet", out, write: said.write }), 0);
    assert.deepEqual(new Uint8Array(readFileSync(out)), plaintext);
    assert.match(said.lines.join("\n"), /no recorded hash/);
  });
});

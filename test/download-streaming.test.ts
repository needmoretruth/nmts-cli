// Downloading without holding the file: what streaming must not cost.
//
// ⛔ THE POINT OF EVERY TEST HERE IS THE DESTINATION, NOT THE BYTES. Plaintext now moves before the
//    last chunk has been checked, so the guarantee "a half-right file never appears" is kept by
//    writing under a temporary name and renaming only after the whole-file digest matches. A
//    version that streamed straight at the destination would pass a test about the bytes of a
//    GOOD file and fail every person who ever downloaded a bad one — so the failure cases assert
//    that nothing is there, INCLUDING the temporary file.
//
// ⚠ The multi-part case is built at a small part size on purpose: what has to be exercised is the
//   path where a file arrives in several parts and several chunks, not the size of a real one.
//   One part here is deliberately larger than the format's 4 MiB chunk so more than one chunk is
//   pushed through the decryptor, which is where a streaming bug would live.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { get } from "../src/commands/get.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { stdoutSink } from "../src/download-sink.ts";
import { NmtsError } from "../src/errors.ts";
import { type ByteDestination, STDOUT_TARGET } from "../src/stdout.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFile, sealFileList, type SealedFile } from "./helpers.ts";

const ITEM_ID = "abcdef12-3456-7890-abcd-ef1234567890";
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

/** Not text, and a terminal would act on it: a NUL, an escape sequence, broken UTF-8. */
const NOT_TEXT = new Uint8Array([0x00, 0x1b, 0x5b, 0x32, 0x4a, 0xff, 0xfe, 0x80]);

let manifestBody: unknown = { state: "absent" };
let partsBody: unknown = { size: 0, parts: [] };
let blobs = new Map<string, Uint8Array>();
/** Every blob the tool asked for. A refusal that happens first asks for none. */
let asked: string[] = [];

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
    const id = decodeURIComponent(blob[1] ?? "");
    asked.push(id);
    const bytes = blobs.get(id);
    if (bytes === undefined) return send(404, { error: { code: "NOT_FOUND", message: "no such blob" } });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(Buffer.from(bytes));
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/** A sandbox with an EMPTY output directory, so "what is left behind" can be counted. */
async function withSandbox(name: string, body: (out: string, code: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
    agg: process.env[AGGREGATOR_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "out");
  mkdirSync(out);
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env", "spend");
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = KEY;
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  asked = [];
  try {
    await body(out, code);
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

async function serve(code: string, name: string, sealed: SealedFile, size: number): Promise<void> {
  const item: ManifestEntry = {
    id: ITEM_ID,
    parentId: null,
    kind: 1,
    name,
    size,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    dekWrapped: sealed.dekWrapped,
    contentHashCt: sealed.contentHashCt,
  };
  manifestBody = {
    state: "present",
    seq: 1,
    ct: await sealFileList(code, await encodeManifest([item], 1)),
    updated_at: "2026-08-24T00:00:00Z",
  };
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

/** A file of `length` bytes nobody could produce by accident. */
function pattern(length: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + seed * 7) % 251;
  return bytes;
}

test("a file bigger than one part, and bigger than one chunk, comes back byte for byte", async () => {
  await withSandbox("stream-multipart", async (out, code) => {
    // Part 0 is larger than the format's 4 MiB chunk, so the decryptor is fed repeatedly and hands
    // back more than one run; part 1 is padded, so its tail must be dropped rather than written.
    const first = pattern(5 * 2 ** 20, 1);
    const second = pattern(2 * 2 ** 20, 2);
    const size = first.length + 900_000;
    await serve(code, "big.bin", await sealFile(code, [first, second], size), size);
    const destination = join(out, "big.bin");

    assert.equal(await get("big.bin", { server: BASE, network: "testnet", out: destination, write: collect().write }), 0);

    const got = new Uint8Array(readFileSync(destination));
    assert.equal(got.length, size, "the file is not the length the sealed list recorded");
    assert.deepEqual(got.subarray(0, first.length), first, "part 0 did not come back byte for byte");
    assert.deepEqual(got.subarray(first.length), second.subarray(0, 900_000), "the padded part was not trimmed");
    assert.deepEqual(readdirSync(out), ["big.bin"], "something else was left in the directory");
  });
});

test("⛔ a part that arrives corrupted leaves NO file at the destination — not a partial one", async () => {
  await withSandbox("stream-corrupt", async (out, code) => {
    // Two parts: the first is whole and will already have been written when the second fails.
    // That is the case a streaming download can get wrong and a buffering one never could.
    const first = pattern(200_000, 3);
    const second = pattern(200_000, 4);
    const sealed = await sealFile(code, [first, second]);
    await serve(code, "two.bin", sealed, first.length + second.length);
    const stored = blobs.get(sealed.parts[1]?.blobId ?? "");
    assert.ok(stored !== undefined, "the second part was not stored");
    stored[stored.length - 1] ^= 0xff;

    const destination = join(out, "two.bin");
    const failure = await get("two.bin", { server: BASE, network: "testnet", out: destination, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(failure instanceof NmtsError, "corrupted bytes were accepted");
    assert.match(failure.message, /did not decrypt/);
    assert.equal(existsSync(destination), false, "a file was written for a download that failed");
    assert.deepEqual(readdirSync(out), [], "the failed download left something behind");
  });
});

test("⛔ a whole file that fails its own hash leaves nothing behind, temporary file included", async () => {
  await withSandbox("stream-hash", async (out, code) => {
    // Every part decrypts and the parts add up: the ONLY thing wrong is the whole-file digest,
    // which is not known until the last byte has already been written to the temporary file.
    const plain = pattern(300_000, 5);
    const sealed = await sealFile(code, [plain]);
    const other = await sealFile(code, [pattern(300_000, 6)]);
    sealed.contentHashCt = other.contentHashCt;
    await serve(code, "h.bin", sealed, plain.length);

    const destination = join(out, "h.bin");
    const failure = await get("h.bin", { server: BASE, network: "testnet", out: destination, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(failure instanceof NmtsError, "a file that failed its own hash was delivered");
    assert.match(failure.message, /does not match the hash/);
    assert.equal(existsSync(destination), false);
    assert.deepEqual(readdirSync(out), [], "the temporary file outlived the failure");
  });
});

test("⛔ `--out -` still refuses bytes a terminal would act on, and writes no file", async () => {
  await withSandbox("stream-terminal", async (out, code) => {
    await serve(code, "shot.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const taken: Uint8Array[] = [];
    const terminal: ByteDestination = { isTerminal: true, write: async (bytes) => void taken.push(bytes) };

    const failure = await get("shot.png", {
      server: BASE,
      network: "testnet",
      out: STDOUT_TARGET,
      write: collect().write,
      stdout: terminal,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(failure instanceof NmtsError, "bytes a terminal acts on were sent to a terminal");
    assert.match(failure.message, /not text and stdout is a terminal/);
    assert.equal(taken.length, 0, "something reached the terminal before the refusal");
    assert.deepEqual(readdirSync(out), [], "a file was written by a mode that writes no files");
  });
});

test("⛔ `--out -` refuses a file above what it can prove before sending, before it reads a byte", async () => {
  const taken: Uint8Array[] = [];
  const sink = stdoutSink({ isTerminal: false, write: async (bytes) => void taken.push(bytes) }, 1_000);

  // The ceiling is asked about with the file's real length, from the sealed list, BEFORE any part
  // is fetched: a pipe cannot be taken back, so this branch has to hold the file to prove it, and
  // the refusal has to arrive while "nothing was sent" is still free.
  assert.throws(() => sink.expect(4_000), (error: unknown) => error instanceof NmtsError && /--out -/.test(error.message));
  assert.equal(taken.length, 0);
  sink.expect(900);
});

test("⛔ a part on a network this build cannot read is refused before anything is fetched", async () => {
  await withSandbox("stream-early", async (out, code) => {
    const plain = pattern(50_000, 7);
    await serve(code, "n.bin", await sealFile(code, [plain]), plain.length);
    const body = partsBody as { parts: { network: number }[] };
    const part = body.parts[0];
    assert.ok(part !== undefined);
    part.network = 1;

    const destination = join(out, "n.bin");
    const failure = await get("n.bin", { server: BASE, network: "testnet", out: destination, write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );

    assert.ok(failure instanceof NmtsError);
    assert.match(failure.message, /cannot read/);
    assert.equal(asked.length, 0, "bytes were fetched for a part this build cannot read");
    assert.deepEqual(readdirSync(out), [], "a refusal that happens first still created a file");
  });
});

// `nmts get --out -` — the file handed to whatever is reading, with nothing left on the disk.
//
// ⛔ THE POINT OF THE OPTION IS THE ABSENCE OF A FILE, so every test here asserts that absence as
//    well as the bytes. A version that wrote the file AND printed it would pass an assertion about
//    the bytes alone, and would leave behind exactly the plaintext copy this exists to avoid.
//
// ⛔ TWO OF THESE RUN THE REAL PROGRAM. Which stream a line went to cannot be seen from inside the
//    process — a collector passed into `get()` proves only that the code called it — and putting
//    the summary on stdout would corrupt the file for the reader without failing anything else.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { get } from "../src/commands/get.ts";
import { mcp } from "../src/commands/mcp.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { type ByteDestination, STDOUT_TARGET } from "../src/stdout.ts";
import { AGGREGATOR_ENV_VAR } from "../src/walrus.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFile, sealFileList, type SealedFile } from "./helpers.ts";

const ITEM_ID = "77777777-6666-5555-4444-333333333333";
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

/**
 * A file that is not text: a NUL, bytes that are not well-formed UTF-8, and an escape sequence.
 *
 * ⛔ Deliberately the hardest payload for this path. It must survive a pipe byte for byte, and it
 *    is the one a terminal must be refused.
 */
const NOT_TEXT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1b, 0x5b, 0x32, 0x4a, 0xff, 0xfe, 0x80]);

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
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/** A destination that keeps what it was given, standing in for this process's stdout. */
function opening(isTerminal: boolean): { taken: Uint8Array[]; to: ByteDestination } {
  const taken: Uint8Array[] = [];
  return { taken, to: { isTerminal, write: async (bytes) => void taken.push(bytes) } };
}

async function withSandbox(name: string, body: (dir: string, code: string) => Promise<void>): Promise<void> {
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
  // The agreements themselves are tested in consent.test.ts; here they would only stop the run.
  grantConsents(dir, "plain-env", "spend");
  process.env[AGGREGATOR_ENV_VAR] = BASE;
  process.env[API_KEY_ENV_VAR] = KEY;
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  try {
    await body(dir, code);
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

/** Put one file in front of the tool: the file list names it, the network holds its parts. */
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
    updated_at: "2026-08-23T00:00:00Z",
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

/**
 * Nothing was created for a destination spelled `-`.
 *
 * ⚠ It looks in the WORKING DIRECTORY because that is where the defect lands: `--out -` used to
 *   reach `resolve("-")`, which is a file called `-` beside whoever ran the command.
 */
/**
 * No file under `dir` holds these bytes.
 *
 * ⚠ Not "the directory is unchanged": the tool keeps state of its own there — the highest file
 *   list version it has seen — and that is not a copy of anybody's file. What must not be there is
 *   the PLAINTEXT.
 */
function assertNoCopyIn(dir: string, bytes: Uint8Array): void {
  for (const found of readdirSync(dir, { withFileTypes: true })) {
    if (!found.isFile()) continue;
    const contents = new Uint8Array(readFileSync(join(dir, found.name)));
    assert.notDeepEqual(contents, bytes, `${found.name} is a copy of the file that was handed over`);
  }
}

function assertNoFileNamedDash(): void {
  const stray = resolve(STDOUT_TARGET);
  const there = existsSync(stray);
  if (there) rmSync(stray, { force: true });
  assert.equal(there, false, `a file was written to ${stray} instead of being handed over`);
}

interface Ran {
  code: number;
  stdout: Buffer;
  stderr: string;
}

/** The real program, with its two streams kept apart and stdout kept as bytes. */
function nmts(args: string[], env: Record<string, string>): Promise<Ran> {
  return new Promise<Ran>((done, failed) => {
    const child = spawn(process.execPath, [MAIN, ...args], { env: { ...process.env, ...env } });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    if (child.stdout === null || child.stderr === null) {
      failed(new Error("the child was started without pipes"));
      return;
    }
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", failed);
    child.on("close", (code) =>
      done({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }),
    );
  });
}

test("`--out -` hands the whole file over and writes no file anywhere", async () => {
  await withSandbox("get-stdout-bytes", async (dir, code) => {
    await serve(code, "photo.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const said = collect();
    const { taken, to } = opening(false);
    const exit = await get("photo.png", {
      server: BASE,
      network: "testnet",
      out: STDOUT_TARGET,
      write: said.write,
      stdout: to,
    });
    assert.equal(exit, 0);
    // ⛔ Byte for byte, including the bytes that are not UTF-8. Comparing text would pass on a
    //    version that decoded and re-encoded the file.
    assert.equal(taken.length, 1, "the file was handed over in pieces or not at all");
    assert.deepEqual(taken[0], NOT_TEXT);
    assertNoCopyIn(dir, NOT_TEXT);
    assertNoFileNamedDash();
  });
});

test("⛔ a file that fails its own hash is refused, and nothing at all reaches the reader", async () => {
  await withSandbox("get-stdout-hash", async (_dir, code) => {
    const sealed = await sealFile(code, [NOT_TEXT]);
    // A different file's hash beside the same bytes: everything decrypts, the file is wrong.
    const other = await sealFile(code, [new Uint8Array(NOT_TEXT.length).fill(4)]);
    sealed.contentHashCt = other.contentHashCt;
    await serve(code, "photo.png", sealed, NOT_TEXT.length);
    const { taken, to } = opening(false);
    const failure = await get("photo.png", {
      server: BASE,
      network: "testnet",
      out: STDOUT_TARGET,
      write: collect().write,
      stdout: to,
    }).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, "a file that failed its own hash was handed over");
    assert.match(failure.message, /does not match the hash/);
    // ⛔ The whole reason the bytes are buffered before any of them move. A version that streamed
    //    would have handed over most of this file before the hash was known.
    assert.equal(taken.length, 0, "part of a wrong file reached the reader");
  });
});

test("⛔ a terminal is not sent bytes it would act on", async () => {
  await withSandbox("get-stdout-tty", async (_dir, code) => {
    await serve(code, "photo.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const { taken, to } = opening(true);
    const failure = await get("photo.png", {
      server: BASE,
      network: "testnet",
      out: STDOUT_TARGET,
      write: collect().write,
      stdout: to,
    }).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, "a stored escape sequence was painted onto a terminal");
    assert.equal(failure.exitCode, 4);
    assert.equal(taken.length, 0);
  });
});

test("a text file IS handed to a terminal — the refusal is about the bytes, not about the option", async () => {
  await withSandbox("get-stdout-tty-text", async (_dir, code) => {
    const note = new TextEncoder().encode("the meeting is at four\n");
    await serve(code, "note.txt", await sealFile(code, [note]), note.length);
    const { taken, to } = opening(true);
    assert.equal(
      await get("note.txt", { server: BASE, network: "testnet", out: STDOUT_TARGET, write: collect().write, stdout: to }),
      0,
    );
    assert.deepEqual(taken[0], note);
  });
});

test("a reader that stops early ends the run quietly, and nothing is said after it", async () => {
  await withSandbox("get-stdout-epipe", async (_dir, code) => {
    await serve(code, "photo.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const said = collect();
    const closed: ByteDestination = {
      isTerminal: false,
      write: () => Promise.reject(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
    };
    assert.equal(
      await get("photo.png", { server: BASE, network: "testnet", out: STDOUT_TARGET, write: said.write, stdout: closed }),
      0,
    );
    // ⛔ Discriminating: a version that carried on would print its summary into a pipe whose
    //    reader has gone, and on a real stdout that is a second EPIPE.
    assert.deepEqual(said.lines, [], "it kept talking to a reader that had gone");
  });
});

test("⛔ the real program puts the file on stdout and everything a person reads on stderr", async () => {
  await withSandbox("get-stdout-real", async (dir, code) => {
    await serve(code, "photo.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const env = {
      NMTS_CONFIG_DIR: dir,
      [CODE_ENV_VAR]: code,
      [API_KEY_ENV_VAR]: KEY,
      [AGGREGATOR_ENV_VAR]: BASE,
    };
    const ran = await nmts(["get", "photo.png", "--out", STDOUT_TARGET, "--server", BASE, "--network", "testnet"], env);
    assert.equal(ran.code, 0, `the run failed — ${ran.stderr}`);
    // ⛔ EXACTLY the file. Not "starts with", not "contains": one extra byte on this stream is one
    //    extra byte in whatever the reader saves.
    assert.equal(Buffer.compare(ran.stdout, Buffer.from(NOT_TEXT)), 0, "stdout was not the file itself");
    assert.match(ran.stderr, /stdout {2}12 bytes/, `the summary did not go to stderr — ${ran.stderr}`);
    assertNoFileNamedDash();
  });
});

test("⛔ --json goes to stderr too, and says `-` rather than a path nobody wrote", async () => {
  await withSandbox("get-stdout-json", async (dir, code) => {
    await serve(code, "photo.png", await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const env = {
      NMTS_CONFIG_DIR: dir,
      [CODE_ENV_VAR]: code,
      [API_KEY_ENV_VAR]: KEY,
      [AGGREGATOR_ENV_VAR]: BASE,
    };
    const ran = await nmts(
      ["get", "photo.png", "--out", STDOUT_TARGET, "--json", "--server", BASE, "--network", "testnet"],
      env,
    );
    assert.equal(ran.code, 0, `the run failed — ${ran.stderr}`);
    assert.equal(Buffer.compare(ran.stdout, Buffer.from(NOT_TEXT)), 0, "the JSON line was written into the file");
    const view = JSON.parse(ran.stderr) as Record<string, unknown>;
    // ⛔ Not a path. A caller that read this as a file name would create the very copy the option
    //    exists to avoid.
    assert.equal(view["writtenTo"], STDOUT_TARGET);
    assert.equal(view["bytes"], NOT_TEXT.length);
    assert.equal(view["contentHashChecked"], true);
  });
});

test("⛔ the MCP server cannot be talked into streaming — a file named `-` is still a file", async () => {
  await withSandbox("get-stdout-mcp", async (dir, code) => {
    const outDir = join(dir, "out");
    mkdirSync(outDir, { recursive: true });
    await serve(code, STDOUT_TARGET, await sealFile(code, [NOT_TEXT]), NOT_TEXT.length);
    const wire: string[] = [];
    await mcp({
      server: BASE,
      network: "testnet",
      out: outDir,
      input: Readable.from([
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "nmts_get", arguments: { path: STDOUT_TARGET } },
        })}\n`,
      ]),
      output: (line) => wire.push(line),
      note: () => undefined,
    });
    assert.equal(wire.length, 1);
    const answered = JSON.parse(wire[0] ?? "{}") as { result?: { content?: { text?: string }[] } };
    const reply = JSON.parse(answered.result?.content?.[0]?.text ?? "{}") as { writtenTo?: string };
    // ⛔ An absolute path inside the chosen directory — never the bare `-`, which on this server
    //    would mean the client's own protocol connection.
    assert.equal(reply.writtenTo, join(outDir, STDOUT_TARGET));
    assert.deepEqual(new Uint8Array(readFileSync(join(outDir, STDOUT_TARGET))), NOT_TEXT);
  });
});

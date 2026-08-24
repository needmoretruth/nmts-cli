// `nmts push` — a whole directory into the drive.
//
// ⛔ THE UPLOAD ITSELF IS SEAMED OUT. What is worth testing here is everything AROUND it: which
//    files are chosen, which are skipped, what is priced, and what a run says after it stops half
//    way. Every one of those needs a failure that costs no money to produce, and driving the real
//    spending path to get one would be testing `upload-file.test.ts` a second time.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { push, type PlannedFile } from "../src/commands/push.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, openFileList, sealFileList } from "./helpers.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

let served: { seq: number; ct: string } | null = null;
let writes = 0;

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/manifest") && req.method === "GET") {
    return served === null
      ? send(200, { state: "absent" })
      : send(200, { state: "present", seq: served.seq, ct: served.ct, updated_at: "2026-08-24T00:00:00Z" });
  }
  if (url.startsWith("/v1/manifest") && req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      const parsed: unknown = JSON.parse(body);
      const ct = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "ct") : null;
      const baseSeq = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "base_seq") : null;
      const now = served?.seq ?? null;
      if (baseSeq !== now) return send(409, { error: { code: "MANIFEST_CONFLICT", message: "stale" } });
      writes += 1;
      served = { seq: (served?.seq ?? 0) + 1, ct: String(ct) };
      return send(200, { seq: served.seq });
    });
    return;
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("no port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function sandbox(
  name: string,
  body: (ctx: { code: string; dir: string; tree: string }) => Promise<void>,
): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tree = join(dir, "tree");
  mkdirSync(tree, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env", "spend");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  process.env[SERVER_ENV_VAR] = BASE;
  process.env[NETWORK_ENV_VAR] = "testnet";
  served = null;
  writes = 0;
  try {
    await body({ code, dir, tree });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", CODE_ENV_VAR, API_KEY_ENV_VAR, SERVER_ENV_VAR, NETWORK_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** A send that records what it was asked to do and never spends anything. */
function recorder(): { sent: string[]; send: (one: PlannedFile, parentId: string | null) => Promise<string> } {
  const sent: string[] = [];
  return {
    sent,
    async send(one) {
      sent.push(`${one.folder}/${one.name}`);
      return one.name;
    },
  };
}

/**
 * Put a list on the server, as the NEXT version of what is there.
 *
 * ⚠ It names the version it was built on, exactly as a real device's would. Serving different
 *   bytes at the same version is what the tool calls a fork, and it refuses — correctly.
 */
async function serveEntries(code: string, entries: ManifestEntry[]): Promise<void> {
  if (served === null) {
    served = { seq: 1, ct: await sealFileList(code, await encodeManifest(entries, 1)) };
    return;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(served.ct));
  const prev = Buffer.from(digest).toString("base64url");
  served = {
    seq: served.seq + 1,
    ct: await sealFileList(code, await encodeManifest(entries, served.seq + 1, prev)),
  };
}

test("a directory goes up with its shape, and the folders are made", async () => {
  await sandbox("push-shape", async ({ code, tree }) => {
    mkdirSync(join(tree, "deep"), { recursive: true });
    writeFileSync(join(tree, "one.txt"), "a");
    writeFileSync(join(tree, "deep", "two.txt"), "bb");
    const rec = recorder();
    assert.equal(await push(tree, { send: rec.send, write: () => {} }), 0);
    assert.deepEqual(rec.sent.sort(), ["tree/deep/two.txt", "tree/one.txt"]);
    const written = await openFileList(code, served?.ct ?? "");
    const folders = written.filter((e) => e.kind === 0).map((e) => e.name).sort();
    assert.deepEqual(folders, ["deep", "tree"], "the local directory becomes a folder, with its own inside");
  });
});

test("⛔ files already in the drive are not sent a second time", async () => {
  // Without this a second run pays for everything again, and — because this tool never replaces a
  // file — the drive fills with numbered copies of what is already there.
  await sandbox("push-again", async ({ code, tree }) => {
    writeFileSync(join(tree, "one.txt"), "a");
    writeFileSync(join(tree, "two.txt"), "bb");
    const first = recorder();
    await push(tree, { send: first.send, write: () => {} });
    assert.equal(first.sent.length, 2);

    // The drive now names them. `send` above did not write the entries, so put them in by hand —
    // what is being tested is the SKIP, and it reads the list.
    const held = await openFileList(code, served?.ct ?? "");
    const folder = held.find((e) => e.name === "tree");
    assert.ok(folder !== undefined);
    await serveEntries(code, [
      ...held,
      { id: "i1", parentId: folder.id, kind: 1, name: "one.txt", size: 1, createdAt: 1, updatedAt: 1 },
      { id: "i2", parentId: folder.id, kind: 1, name: "two.txt", size: 2, createdAt: 1, updatedAt: 1 },
    ]);

    const second = recorder();
    const lines: string[] = [];
    assert.equal(await push(tree, { send: second.send, write: (l) => lines.push(l) }), 0);
    assert.deepEqual(second.sent, [], "it paid for the same two files again");
    assert.match(lines.join(" "), /2 already there/);
  });
});

test("⛔ it stops at the first failure and says what is already paid for", async () => {
  await sandbox("push-stop", async ({ tree }) => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) writeFileSync(join(tree, name), name);
    const sent: string[] = [];
    await assert.rejects(
      push(tree, {
        write: () => {},
        async send(one) {
          if (one.name === "b.txt") throw new Error("the server refused");
          sent.push(one.name);
          return one.name;
        },
      }),
      (error: unknown) => {
        const step = error instanceof Error && "nextStep" in error ? String(Reflect.get(error, "nextStep")) : "";
        assert.match(step, /1 file is uploaded and paid for/);
        assert.match(step, /sends only what is missing/);
        return true;
      },
    );
    assert.deepEqual(sent, ["a.txt"], "it kept spending after something went wrong");
  });
});

test("⛔ names beginning with a dot are left alone unless asked for", async () => {
  // A directory of source code carries credentials in exactly those files, and an upload goes to a
  // public storage network.
  await sandbox("push-hidden", async ({ tree }) => {
    writeFileSync(join(tree, ".credentials"), "not for a public network");
    writeFileSync(join(tree, "readme.txt"), "fine");
    mkdirSync(join(tree, ".git"), { recursive: true });
    writeFileSync(join(tree, ".git", "config"), "also hidden");

    const plain = recorder();
    await push(tree, { send: plain.send, write: () => {} });
    assert.deepEqual(plain.sent, ["tree/readme.txt"]);

    served = null;
    const asked = recorder();
    await push(tree, { hidden: true, send: asked.send, write: () => {} });
    assert.deepEqual(asked.sent.sort(), ["tree/.credentials", "tree/.git/config", "tree/readme.txt"]);
  });
});

test("a symbolic link is not followed", async () => {
  await sandbox("push-link", async ({ tree, dir }) => {
    writeFileSync(join(tree, "real.txt"), "here");
    writeFileSync(join(dir, "outside.txt"), "not yours");
    symlinkSync(join(dir, "outside.txt"), join(tree, "link.txt"));
    symlinkSync(dir, join(tree, "up"));
    const rec = recorder();
    assert.equal(await push(tree, { send: rec.send, write: () => {} }), 0);
    assert.deepEqual(rec.sent, ["tree/real.txt"]);
  });
});

test("--dry-run prices only what would be sent, and sends nothing", async () => {
  await sandbox("push-dry", async ({ code, tree }) => {
    writeFileSync(join(tree, "one.txt"), "a".repeat(100));
    writeFileSync(join(tree, "two.txt"), "b".repeat(100));
    await serveEntries(code, []);
    const before = writes;
    const lines: string[] = [];
    assert.equal(await push(tree, { dryRun: true, write: (l) => lines.push(l) }), 0);
    assert.equal(writes, before, "a dry run wrote to the file list");
    const said = lines.join(" ").replace(/\s+/g, " ");
    assert.match(said, /2 files/);
    assert.match(said, /Nothing was sent and nothing was charged/);
  });
});

test("an empty directory says so rather than asking for an agreement", async () => {
  await sandbox("push-empty", async ({ tree }) => {
    const lines: string[] = [];
    assert.equal(await push(tree, { write: (l) => lines.push(l) }), 0);
    assert.match(lines.join(" "), /holds no files to send/);
  });
});

test("a file, not a directory, is refused and points at the command that takes one", async () => {
  await sandbox("push-file", async ({ tree }) => {
    const one = join(tree, "single.txt");
    writeFileSync(one, "x");
    await assert.rejects(push(one, { write: () => {} }), /is a file/);
  });
});

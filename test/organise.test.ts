// `rm`, `restore`, `mkdir`, `mv`, `rename` — the edits that change the drive without moving bytes.
//
// ⛔ EVERY ASSERTION READS THE BLOB THE TOOL ACTUALLY SENT, opened with the engine. Asserting on
//    the message it printed would pass while the sealed list said something else, and the sealed
//    list is the only thing another device will ever see.
//
// ⛔ AND THE SERVER CALLS ARE COUNTED. "The drive shows it in the trash" is half the job: a file
//    whose server row is still live goes on costing storage and is never swept. The order matters
//    too, and one test asserts it.
//
// ⛔ THE FAKE SERVER ENFORCES `base_seq`, AND THAT IS THE POINT OF IT (2026-08-23).
//    Until it did, this file had 228 green tests of which NOT ONE could fail for a defect in the
//    compare-and-swap retry — the part `manifest-write.ts` spends nineteen header lines saying is
//    load-bearing. `steal` makes another writer win exactly once, so the retry is entered for
//    real, on the real refusal, in the real order.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { mkdir, mv, rename } from "../src/commands/organise.ts";
import { restore, rm } from "../src/commands/trash.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, openFileList, sealFileList } from "./helpers.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

/** What the fake server holds and what it was asked to do, in the order it was asked. */
let served: { seq: number; ct: string } | null = null;
let written: string[] = [];
let calls: string[] = [];
/** A sealed list another device writes the instant the tool tries to. One shot. */
let steal: string | null = null;
/** Server rows that answer 404 — what an interrupted run leaves behind. */
let missingRows = new Set<string>();

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const method = req.method ?? "GET";
  calls.push(`${method} ${url}`);
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (method === "GET" && url.startsWith("/v1/manifest")) {
    if (served === null) return json(200, { state: "absent" });
    return json(200, { state: "present", seq: served.seq, ct: served.ct, updated_at: "2026-08-23T00:00:00Z" });
  }
  if (method === "PUT" && url.startsWith("/v1/manifest")) {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const body = JSON.parse(raw) as { ct: string; base_seq: number | null };
      // Another device gets in first, exactly once, at the moment the tool tries to write.
      if (steal !== null) {
        const winner = steal;
        steal = null;
        served = { seq: (served?.seq ?? 0) + 1, ct: winner };
        return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
      }
      // ⛔ THE REAL RULE, NOT A RUBBER STAMP. A fake that accepts any write can never enter the
      //    retry path, so every defect that lives there is invisible to the whole suite.
      if ((body.base_seq ?? 0) !== (served?.seq ?? 0)) {
        return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
      }
      written.push(body.ct);
      const seq = (served?.seq ?? 0) + 1;
      served = { seq, ct: body.ct };
      json(200, { seq });
    });
    return;
  }
  if (url.startsWith("/v1/items/")) {
    if (missingRows.has(url)) return json(404, { error: { code: "NOT_FOUND", message: "no such item" } });
    return json(204, {});
  }
  return json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: (code: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  served = null;
  written = [];
  calls = [];
  steal = null;
  missingRows = new Set<string>();
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [["NMTS_CONFIG_DIR", before.dir], [CODE_ENV_VAR, before.code], [API_KEY_ENV_VAR, before.key]] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

function entry(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return { parentId: null, kind: 1, size: 10, createdAt: 1, updatedAt: 1, ...over };
}

async function serve(code: string, entries: ManifestEntry[]): Promise<void> {
  served = { seq: 1, ct: await sealFileList(code, await encodeManifest(entries, 1)) };
}

/** What the tool last wrote, opened. ⛔ Not what it said it wrote. */
async function lastWritten(code: string): Promise<ManifestEntry[]> {
  const ct = written.at(-1);
  assert.ok(ct !== undefined, "the tool wrote no file list at all");
  return openFileList(code, ct);
}

const collect = (): { lines: string[]; write: (line: string) => void } => {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
};

const opts = (out: { write: (line: string) => void }) => ({ server: BASE, network: "testnet", write: out.write });

// ── rm ────────────────────────────────────────────────────────────────────────────────────────

test("rm moves one file to the trash in the list AND deletes its row on the server", async () => {
  await withSandbox("org-rm", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const out = collect();
    assert.equal(await rm(["notes.txt"], opts(out)), 0);

    const after_ = await lastWritten(code);
    assert.equal(after_.length, 1, "the entry was removed instead of trashed");
    assert.ok(after_[0]?.deletedAt !== undefined, "the entry is not marked as trashed");
    // ⛔ The row too. A drive that shows it trashed while the server still holds it live goes on
    //    costing storage and is never swept.
    assert.ok(calls.includes("DELETE /v1/items/a"), `the server row was not deleted — ${calls.join(" · ")}`);
    assert.match(out.lines.join("\n"), /trash/i);
  });
});

test("⛔ the server row goes first — a failed delete leaves the drive untouched", async () => {
  await withSandbox("org-rm-order", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    await rm(["notes.txt"], opts(collect()));
    const deleteAt = calls.indexOf("DELETE /v1/items/a");
    const putAt = calls.findIndex((c) => c.startsWith("PUT /v1/manifest"));
    assert.ok(deleteAt >= 0 && putAt >= 0, `both calls must happen — ${calls.join(" · ")}`);
    // ⛔ A trashed item's bytes cannot be fetched, so the state to avoid is a drive that shows a
    //    file as live when the server has already trashed it. Writing the list second is what
    //    makes a failed server call leave the drive exactly as it was.
    assert.ok(deleteAt < putAt, `the file list was written before the server agreed — ${calls.join(" · ")}`);
  });
});

test("rm of a folder deletes the rows of every file under it, at any depth", async () => {
  await withSandbox("org-rm-folder", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "photos", kind: 0, size: 0 }),
      entry({ id: "f2", name: "2026", kind: 0, size: 0, parentId: "f1" }),
      entry({ id: "deep", name: "a.jpg", parentId: "f2" }),
      entry({ id: "shallow", name: "b.jpg", parentId: "f1" }),
      entry({ id: "elsewhere", name: "c.jpg" }),
    ]);
    assert.equal(await rm(["photos"], opts(collect())), 0);
    assert.ok(calls.includes("DELETE /v1/items/deep"), "a file two folders down was left live");
    assert.ok(calls.includes("DELETE /v1/items/shallow"));
    // ⛔ Discriminating: a version that deleted EVERY file would also pass the two above.
    assert.ok(!calls.includes("DELETE /v1/items/elsewhere"), "it deleted a file outside the folder");

    const after_ = await lastWritten(code);
    assert.ok(after_.find((e) => e.id === "f1")?.deletedAt !== undefined, "the folder is not trashed");
    // ⛔ Children keep their own clock. Stamping them would reset each one's 30-day window and
    //    make restoring the folder ambiguous.
    assert.equal(after_.find((e) => e.id === "deep")?.deletedAt, undefined);
  });
});

test("rm of something already in the trash says so instead of trashing it again", async () => {
  await withSandbox("org-rm-twice", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt", deletedAt: 5 })]);
    const failure = await rm(["notes.txt"], opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /in the trash/);
    assert.equal(written.length, 0, "it wrote a file list for a no-op");
  });
});

// ── restore ───────────────────────────────────────────────────────────────────────────────────

test("restore brings a trashed file back in the list and on the server", async () => {
  await withSandbox("org-restore", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt", deletedAt: 5 })]);
    assert.equal(await restore(["notes.txt"], opts(collect())), 0);
    assert.ok(calls.includes("POST /v1/items/a/restore"), `the row was not restored — ${calls.join(" · ")}`);
    assert.equal((await lastWritten(code))[0]?.deletedAt, undefined, "still trashed in the list");
  });
});

test("restore of something that is not in the trash changes nothing", async () => {
  await withSandbox("org-restore-live", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const out = collect();
    assert.equal(await restore(["notes.txt"], opts(out)), 0);
    assert.equal(written.length, 0, "it wrote a file list for a no-op");
    assert.match(out.lines.join("\n"), /not in the trash/);
  });
});

// ── mkdir ─────────────────────────────────────────────────────────────────────────────────────

test("mkdir makes the folder and every missing folder above it", async () => {
  await withSandbox("org-mkdir", async (code) => {
    await serve(code, []);
    const out = collect();
    assert.equal(await mkdir("photos/2026/august", opts(out)), 0);
    const after_ = await lastWritten(code);
    const names = after_.filter((e) => e.kind === 0).map((e) => e.name).sort();
    assert.deepEqual(names, ["2026", "august", "photos"]);
    // ⛔ The SHAPE, not just the count: three folders side by side at the root would also be three.
    const byName = new Map(after_.map((e) => [e.name, e]));
    assert.equal(byName.get("photos")?.parentId, null);
    assert.equal(byName.get("2026")?.parentId, byName.get("photos")?.id);
    assert.equal(byName.get("august")?.parentId, byName.get("2026")?.id);
  });
});

test("mkdir of a folder that is already there writes nothing", async () => {
  await withSandbox("org-mkdir-again", async (code) => {
    await serve(code, [entry({ id: "f1", name: "photos", kind: 0, size: 0 })]);
    const out = collect();
    assert.equal(await mkdir("photos", opts(out)), 0);
    assert.equal(written.length, 0, "it rewrote the list for a folder that existed");
    assert.match(out.lines.join("\n"), /already there/);
  });
});

test("⛔ mkdir under a FILE refuses instead of making a folder nothing can reach", async () => {
  await withSandbox("org-mkdir-under-file", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const failure = await mkdir("notes.txt/inside", opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 4);
    assert.equal(written.length, 0);
  });
});

// ── mv ────────────────────────────────────────────────────────────────────────────────────────

test("mv puts a file into a folder", async () => {
  await withSandbox("org-mv", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "archive", kind: 0, size: 0 }),
      entry({ id: "a", name: "notes.txt" }),
    ]);
    assert.equal(await mv(["notes.txt", "archive"], opts(collect())), 0);
    assert.equal((await lastWritten(code)).find((e) => e.id === "a")?.parentId, "f1");
  });
});

// ⚠ ITS OWN ACCOUNT, not a second act of the test above. This machine remembers the highest list
//   version it has seen per account and refuses one that goes backwards — which is a real
//   protection, and re-serving version 1 to set up a second scenario trips it.
test("mv to / brings a file back out to the top of the drive", async () => {
  await withSandbox("org-mv-out", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "archive", kind: 0, size: 0 }),
      entry({ id: "a", name: "notes.txt", parentId: "f1" }),
    ]);
    assert.equal(await mv(["archive/notes.txt", "/"], opts(collect())), 0);
    assert.equal((await lastWritten(code)).find((e) => e.id === "a")?.parentId, null);
  });
});

test("⛔ mv refuses to put a folder inside itself", async () => {
  await withSandbox("org-mv-loop", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "photos", kind: 0, size: 0 }),
      entry({ id: "f2", name: "2026", kind: 0, size: 0, parentId: "f1" }),
    ]);
    const failure = await mv(["photos", "photos/2026"], opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, "a folder was moved inside its own child");
    assert.equal(written.length, 0);
  });
});

test("⛔ mv onto a taken name refuses rather than making two things look the same", async () => {
  await withSandbox("org-mv-collide", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "archive", kind: 0, size: 0 }),
      entry({ id: "a", name: "notes.txt" }),
      entry({ id: "b", name: "notes.txt", parentId: "f1" }),
    ]);
    const failure = await mv(["notes.txt", "archive"], opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError);
    assert.equal(written.length, 0);
  });
});

// ── rename ────────────────────────────────────────────────────────────────────────────────────

test("rename changes the name and nothing else", async () => {
  await withSandbox("org-rename", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt", parentId: null })]);
    assert.equal(await rename("notes.txt", "meeting notes.txt", opts(collect())), 0);
    const only = (await lastWritten(code))[0];
    assert.equal(only?.name, "meeting notes.txt");
    assert.equal(only?.parentId, null);
    assert.equal(only?.id, "a", "renaming replaced the entry instead of editing it");
  });
});

test("⛔ rename refuses a name already used in that folder — it does not number it", async () => {
  await withSandbox("org-rename-collide", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" }), entry({ id: "b", name: "other.txt" })]);
    const failure = await rename("notes.txt", "other.txt", opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, "it renamed onto a taken name");
    assert.equal(failure.exitCode, 4);
    assert.equal(written.length, 0);
  });
});

test("⛔ a name containing a slash is refused — that would be a move, silently", async () => {
  await withSandbox("org-rename-slash", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    const failure = await rename("notes.txt", "archive/notes.txt", opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 2);
    assert.equal(written.length, 0);
  });
});

test("rename to the name it already has writes nothing", async () => {
  await withSandbox("org-rename-same", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" })]);
    assert.equal(await rename("notes.txt", "notes.txt", opts(collect())), 0);
    assert.equal(written.length, 0, "a no-op cost every other device a download");
  });
});

// ── paths ─────────────────────────────────────────────────────────────────────────────────────

test("⛔ a path matching two things is refused, not resolved to the first", async () => {
  await withSandbox("org-ambiguous", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt" }), entry({ id: "b", name: "notes.txt" })]);
    const failure = await rm(["notes.txt"], opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError, "it picked one of two files with the same path");
    assert.match(failure.message, /2 things/);
    assert.equal(calls.filter((c) => c.startsWith("DELETE")).length, 0, "it deleted a row anyway");
  });
});

test("a path that matches only a trashed entry says so rather than 'no such path'", async () => {
  await withSandbox("org-trashed-path", async (code) => {
    await serve(code, [entry({ id: "a", name: "notes.txt", deletedAt: 5 })]);
    const failure = await mv(["notes.txt", "/"], opts(collect())).then(() => null, (e: unknown) => e);
    assert.ok(failure instanceof NmtsError);
    assert.match(failure.message, /in the trash/);
  });
});

test("the whole path is matched, not the last name", async () => {
  await withSandbox("org-whole-path", async (code) => {
    await serve(code, [
      entry({ id: "f1", name: "photos", kind: 0, size: 0 }),
      entry({ id: "deep", name: "a.jpg", parentId: "f1" }),
      entry({ id: "top", name: "a.jpg" }),
    ]);
    assert.equal(await rename("photos/a.jpg", "b.jpg", opts(collect())), 0);
    const after_ = await lastWritten(code);
    assert.equal(after_.find((e) => e.id === "deep")?.name, "b.jpg");
    assert.equal(after_.find((e) => e.id === "top")?.name, "a.jpg", "it renamed the one at the root");
  });
});

// The defects an adversarial review found in the five list-editing commands, each with a test that
// FAILS when the fix is removed (2026-08-23).
//
// ⛔ WHY THIS FILE EXISTS AT ALL. The suite had 228 green tests and not one of them could fail for
//    any of the four serious defects found that day. Two reasons, and both are in this harness:
//      · the fake server accepted every write, so the compare-and-swap retry — where two of the
//        defects lived — was never entered;
//      · every fixture was one flat folder, so "trashed by inheritance" never arose.
//    A test that cannot go red is a comment with a runtime cost.
//
// ⛔ EVERY ASSERTION READS THE SEALED LIST THE TOOL ACTUALLY SENT, or the server calls it actually
//    made. What the command printed is the one thing that cannot be trusted here — three of the
//    four defects printed a cheerful, wrong sentence and exited 0.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { get } from "../src/commands/get.ts";
import { ls } from "../src/commands/ls.ts";
import { mkdir, mv, rename } from "../src/commands/organise.ts";
import { restore, rm } from "../src/commands/trash.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, openFileList, sealFileList } from "./helpers.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

let served: { seq: number; ct: string } | null = null;
let written: string[] = [];
let calls: string[] = [];
/** A sealed list another device writes the instant the tool tries to. One shot. */
let steal: string | null = null;

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
      if (steal !== null) {
        const winner = steal;
        steal = null;
        served = { seq: (served?.seq ?? 0) + 1, ct: winner };
        return json(409, { error: { code: "VERSION_CONFLICT", message: "the list moved" } });
      }
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
  if (url.startsWith("/v1/items/")) return json(204, {});
  return json(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: (code: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
  };
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
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

function entry(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return { parentId: null, kind: 1, size: 10, createdAt: 1, updatedAt: 1, ...over };
}
const folder = (over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry =>
  entry({ kind: 0, size: 0, ...over });

async function serve(code: string, entries: ManifestEntry[]): Promise<void> {
  served = { seq: 1, ct: await sealFileList(code, await encodeManifest(entries, 1)) };
}
/**
 * A sealed list for the OTHER device to win with.
 *
 * ⚠ It has to name the version it was built on, exactly as a real device's would — the fork check
 *   refuses a list that does not, and a fixture that skipped it would be testing a shape the tool
 *   will never meet.
 */
async function otherDeviceWrites(code: string, entries: ManifestEntry[]): Promise<void> {
  const held = served;
  assert.ok(held !== null, "nothing is being served, so nothing can be raced");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(held.ct));
  const prev = Buffer.from(digest).toString("base64url");
  steal = await sealFileList(code, await encodeManifest(entries, held.seq + 1, prev));
}
async function lastWritten(code: string): Promise<ManifestEntry[]> {
  const ct = written.at(-1);
  assert.ok(ct !== undefined, "the tool wrote no file list at all");
  return openFileList(code, ct);
}
const collect = (): { lines: string[]; write: (line: string) => void } => {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
};
const opts = (out: { write: (line: string) => void }) => ({
  server: BASE,
  network: "testnet",
  write: out.write,
});
const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

// ── trash is inherited ────────────────────────────────────────────────────────────────────────

const tree = (): ManifestEntry[] => [
  folder({ id: "F", name: "photos" }),
  entry({ id: "a", name: "a.jpg", parentId: "F" }),
  entry({ id: "b", name: "b.jpg", parentId: "F" }),
];

test("⛔ a file under a trashed folder is not listed as live — the server has stopped serving it", async () => {
  await withSandbox("inherit-ls", async (code) => {
    await serve(code, tree());
    assert.equal(await rm(["/photos"], opts(collect())), 0);

    const out = collect();
    assert.equal(await ls({ ...opts(out), json: true }), 0);
    const shown = JSON.parse(out.lines.join("")) as {
      entries: { path: string }[];
      hiddenTrashed: number;
    };
    assert.deepEqual(
      shown.entries.map((e) => e.path),
      [],
      "a file whose folder is in the trash was listed as live",
    );
    assert.equal(shown.hiddenTrashed, 3, "the count did not include the files under the folder");
  });
});

test("⛔ a file under a trashed folder cannot be addressed, fetched, or moved", async () => {
  await withSandbox("inherit-address", async (code) => {
    await serve(code, tree());
    assert.equal(await rm(["/photos"], opts(collect())), 0);

    // ⚠ MADE ONE AT A TIME, not all three up front. A rejected promise nobody is awaiting yet is
    //   an unhandled rejection, and the test runner fails the test for it — so an array of started
    //   calls turns "all three refuse" into a race between how fast each one refuses and how fast
    //   the loop gets round to it.
    for (const run of [
      () => get("photos/a.jpg", opts(collect())),
      () => rename("photos/a.jpg", "c.jpg", opts(collect())),
      () => mv(["photos/a.jpg", ""], opts(collect())),
    ]) {
      const failure = await refusal(run());
      assert.match(failure.message, /in the trash|No file at/, `wrong reason: ${failure.message}`);
    }
  });
});

test("⛔ restoring a folder does not un-delete a file the person trashed on its own", async () => {
  await withSandbox("inherit-restore", async (code) => {
    await serve(code, [
      folder({ id: "F", name: "photos", deletedAt: 9 }),
      entry({ id: "keep", name: "keep.jpg", parentId: "F" }),
      entry({ id: "own", name: "own.jpg", parentId: "F", deletedAt: 5 }),
    ]);
    assert.equal(await restore(["/photos"], opts(collect())), 0);

    assert.ok(calls.includes("POST /v1/items/keep/restore"), `keep.jpg was not restored — ${calls.join(" · ")}`);
    assert.ok(
      !calls.includes("POST /v1/items/own/restore"),
      "a file the person deleted separately had its row brought back, cancelling its own 30 days",
    );
    const after = await lastWritten(code);
    assert.equal(after.find((e) => e.id === "own")?.deletedAt, 5, "its own instant was disturbed");
  });
});

// ── the compare-and-swap retry ────────────────────────────────────────────────────────────────

test("⛔ a rename that loses the race refuses instead of making two things share one path", async () => {
  await withSandbox("cas-rename", async (code) => {
    await serve(code, [folder({ id: "A", name: "A" }), folder({ id: "n", name: "n", parentId: "A" })]);
    // While the tool is writing, another device puts an "m" in the same folder.
    await otherDeviceWrites(code, [
      folder({ id: "A", name: "A" }),
      folder({ id: "n", name: "n", parentId: "A" }),
      folder({ id: "m2", name: "m", parentId: "A" }),
    ]);

    const failure = await refusal(rename("A/n", "m", opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /already in that folder/);
    assert.equal(written.length, 0, "it wrote a list that put two folders at one path");
  });
});

test("⛔ a move that loses the race refuses instead of making two things share one path", async () => {
  await withSandbox("cas-mv", async (code) => {
    await serve(code, [
      folder({ id: "S", name: "src" }),
      folder({ id: "D", name: "dst" }),
      entry({ id: "t", name: "thing", parentId: "S" }),
    ]);
    await otherDeviceWrites(code, [
      folder({ id: "S", name: "src" }),
      folder({ id: "D", name: "dst" }),
      entry({ id: "t", name: "thing", parentId: "S" }),
      entry({ id: "t2", name: "thing", parentId: "D" }),
    ]);

    const failure = await refusal(mv(["src/thing", "dst"], opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /already in that folder/);
    assert.equal(written.length, 0, "it wrote a list that put two entries at one path");
  });
});

test("⛔ mkdir that loses the race adopts the folder that won, rather than making a second", async () => {
  await withSandbox("cas-mkdir", async (code) => {
    await serve(code, []);
    await otherDeviceWrites(code, [folder({ id: "won", name: "shared" })]);

    const out = collect();
    assert.equal(await mkdir("/shared", opts(out)), 0);
    assert.equal(written.length, 0, "it made a second folder for a name that was already taken");
    assert.match(out.lines.join("\n"), /already there/);
  });
});

test("⛔ a trashed folder of the same name does not turn mkdir into a renaming machine", async () => {
  await withSandbox("mkdir-trashed-name", async (code) => {
    await serve(code, [folder({ id: "old", name: "photos", deletedAt: 4 })]);

    const out = collect();
    assert.equal(await mkdir("/photos", opts(out)), 0);
    const after = await lastWritten(code);
    const live = after.filter((e) => e.deletedAt === undefined);
    assert.deepEqual(
      live.map((e) => e.name),
      ["photos"],
      "it invented a numbered name while reporting the one that was asked for",
    );
    assert.match(out.lines.join("\n"), /"photos"/);
  });
});

// ── names ─────────────────────────────────────────────────────────────────────────────────────

test("⛔ everything after `--` is a name, so a file called `-h` can be addressed", async () => {
  await withSandbox("end-of-options", async (code) => {
    await serve(code, [entry({ id: "h", name: "-h" })]);
    // Straight through the argument parser, the way a shell hands it over.
    const { run } = await import("../src/main.ts");
    // ⚠ `--server` comes BEFORE the `--`. That is the whole point of the token: everything after
    //   it is a name, so an option written there would be taken as one — which is exactly what a
    //   shell does too.
    const code2 = await run(["rm", "--server", BASE, "--network", "testnet", "--", "-h"]);
    assert.equal(code2, 0, "it did not treat the operand as a name");
    assert.equal((await lastWritten(code))[0]?.deletedAt !== undefined, true, "nothing was trashed");
  });
});

test("⛔ one visible name is one name, whichever way unicode spells it", async () => {
  await withSandbox("nfc", async (code) => {
    // The stored name is decomposed (e + combining acute); the caller types the composed form.
    await serve(code, [folder({ id: "c", name: "café" })]);
    assert.equal(await rename("café", "tea", opts(collect())), 0);
    assert.equal((await lastWritten(code))[0]?.name, "tea");
  });
});

test("⛔ making a second entry with the same visible name is refused, not numbered", async () => {
  await withSandbox("nfc-collide", async (code) => {
    await serve(code, [folder({ id: "c", name: "café" }), folder({ id: "d", name: "tea" })]);
    const failure = await refusal(rename("tea", "café", opts(collect())));
    assert.equal(failure.exitCode, 4);
    assert.equal(written.length, 0);
  });
});

test("⛔ an entry whose parent vanished does not take a healthy file hostage", async () => {
  await withSandbox("detached", async (code) => {
    await serve(code, [
      entry({ id: "ok", name: "a.txt" }),
      entry({ id: "orphan", name: "a.txt", parentId: "gone" }),
    ]);

    const out = collect();
    assert.equal(await ls({ ...opts(out), json: true }), 0);
    const shown = JSON.parse(out.lines.join("")) as { entries: { path: string }[] };
    assert.deepEqual(
      shown.entries.map((e) => e.path).sort(),
      ["a.txt", "…/a.txt"],
      "the two were printed at the same path",
    );

    // And the healthy one is still addressable by the path that was printed for it.
    assert.equal(await rename("a.txt", "b.txt", opts(collect())), 0);
    const after = await lastWritten(code);
    assert.equal(after.find((e) => e.id === "ok")?.name, "b.txt");
    assert.equal(after.find((e) => e.id === "orphan")?.name, "a.txt");
  });
});

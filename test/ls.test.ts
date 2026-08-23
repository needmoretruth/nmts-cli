// `nmts ls` against a real local server. No fetch mocking: what is being tested is the wire and
// the crypto, and a stubbed fetch would prove only that this file agrees with itself.
//
// ⛔ THE LISTS ARE SEALED WITH THE ENGINE, not with a fixture. A recorded blob would freeze one
//    day's format into a test that keeps passing after the format moves.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { ls } from "../src/commands/ls.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, sealFileList } from "./helpers.ts";

let answer: { status: number; body: unknown } = { status: 200, body: { state: "absent" } };
let lastAuth: string | undefined;

// ⛔ IT ROUTES BY PATH, and that is not decoration. It used to answer ANY url, which meant a tool
//    asking for the wrong address still got a file list — and it did: `/manifest` instead of
//    `/v1/manifest` passed every test here and failed against a real server.
let lastPath: string | null = null;
const server: Server = createServer((req, res) => {
  lastAuth = req.headers.authorization;
  lastPath = req.url ?? null;
  if (!(req.url ?? "").startsWith("/v1/manifest")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such route" } }));
    return;
  }
  res.writeHead(answer.status, { "content-type": "application/json" });
  res.end(JSON.stringify(answer.body));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

// ⛔ ASSEMBLED, NEVER WRITTEN DOWN. A 65-character string in the exact shape of a credential
//    trips every secret scanner that ever reads this repository, and somebody would then have
//    to prove it was never real. Nothing here checks the shape: the test server accepts any
//    string, and what is being tested is where the value goes, not what it is.
const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

async function withSandbox(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

function entry(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return {
    parentId: null,
    kind: 1,
    size: 1234,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

/** base64url SHA-256 of a sealed blob — what a later version carries as its `prev`. */
async function fingerprint(ct: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ct));
  return Buffer.from(digest).toString("base64url");
}

/** The last blob served, so a chained list can name a `prev` that really existed. */
let lastCt: string | null = null;

async function serveList(code: string, entries: ManifestEntry[], seq: number): Promise<void> {
  // ⛔ Version 1 has nothing before it; every later one must name what it continued from, and the
  //    codec refuses to write one that does not. Chaining from the blob actually served keeps
  //    these tests honest about the format instead of inventing a `prev` the codec merely accepts.
  const prev = seq > 1 ? (lastCt === null ? await fingerprint("nothing this machine ever saw") : await fingerprint(lastCt)) : undefined;
  const body = await encodeManifest(entries, seq, prev);
  const ct = await sealFileList(code, body);
  lastCt = ct;
  answer = { status: 200, body: { state: "present", seq, ct, updated_at: "2026-08-23T00:00:00Z" } };
}

test("without an account code it exits 3 rather than reporting an empty account", async () => {
  await withSandbox("ls-nocode", async () => {
    delete process.env[CODE_ENV_VAR];
    process.env[API_KEY_ENV_VAR] = KEY;
    const failure = await ls({ server: BASE, network: "testnet" }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "a missing code must not be a successful empty listing");
    assert.equal(failure.exitCode, 3);
  });
});

test("⛔ without an API key it says so and names the way to supply one — the server needs it", async () => {
  await withSandbox("ls-nokey", async () => {
    process.env[CODE_ENV_VAR] = await generateCode();
    delete process.env[API_KEY_ENV_VAR];
    const failure = await ls({ server: BASE, network: "testnet" }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 3);
    assert.match(`${failure.message} ${failure.nextStep ?? ""}`, new RegExp(API_KEY_ENV_VAR));
  });
});

test("⛔ it asks the address the server actually serves", async () => {
  await withSandbox("ls-path", async () => {
    process.env[CODE_ENV_VAR] = await generateCode();
    process.env[API_KEY_ENV_VAR] = KEY;
    answer = { status: 200, body: { state: "absent" } };
    await ls({ server: BASE, network: "testnet", write: collect().write });
    assert.equal(lastPath, "/v1/manifest");
  });
});

test("the key goes in the Authorization header and nowhere else", async () => {
  await withSandbox("ls-auth", async () => {
    process.env[CODE_ENV_VAR] = await generateCode();
    process.env[API_KEY_ENV_VAR] = KEY;
    answer = { status: 200, body: { state: "absent" } };
    const out = collect();
    await ls({ server: BASE, network: "testnet", write: out.write });
    assert.equal(lastAuth, `Bearer ${KEY}`);
    assert.ok(!out.lines.join("\n").includes(KEY), "the key was printed");
  });
});

test("an account with no list says so instead of printing an empty table", async () => {
  await withSandbox("ls-absent", async () => {
    process.env[CODE_ENV_VAR] = await generateCode();
    process.env[API_KEY_ENV_VAR] = KEY;
    answer = { status: 200, body: { state: "absent" } };
    const out = collect();
    assert.equal(await ls({ server: BASE, network: "testnet", write: out.write }), 0);
    assert.match(out.lines.join("\n"), /no file list yet/);
  });
});

test("a sealed list is opened and printed with paths, not ids", async () => {
  await withSandbox("ls-present", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(
      code,
      [
        entry({ id: "f1", name: "notes.txt", size: 2000 }),
        entry({ id: "d1", name: "photos", kind: 0, size: 0 }),
        entry({ id: "f2", name: "beach.jpg", parentId: "d1", size: 4_000_000 }),
      ],
      3,
    );
    const out = collect();
    assert.equal(await ls({ server: BASE, network: "testnet", write: out.write }), 0);
    const text = out.lines.join("\n");
    assert.match(text, /photos\/beach\.jpg/, "a nested file must show its path");
    assert.match(text, /notes\.txt/);
    assert.ok(!text.includes("f1"), "ids are not what a person asked for");
    assert.match(text, /2 files/);
  });
});

test("--json is parseable and carries the version the SEALED list claims", async () => {
  await withSandbox("ls-json", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(code, [entry({ id: "f1", name: "a.txt" })], 7);
    const out = collect();
    await ls({ server: BASE, network: "testnet", json: true, write: out.write });
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const view = parsed as Record<string, unknown>;
    assert.equal(view["state"], "present");
    assert.equal(view["seq"], 7);
    assert.deepEqual((view["entries"] as { path: string }[]).map((e) => e.path), ["a.txt"]);
  });
});

test("⛔ trashed entries are hidden AND the hiding is said out loud", async () => {
  await withSandbox("ls-trash", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(
      code,
      [entry({ id: "f1", name: "kept.txt" }), entry({ id: "f2", name: "gone.txt", deletedAt: 1 })],
      2,
    );
    const quiet = collect();
    await ls({ server: BASE, network: "testnet", write: quiet.write });
    const text = quiet.lines.join("\n");
    assert.ok(!text.includes("gone.txt"), "a trashed file is not in the listing");
    assert.match(text, /1 in the trash, hidden/, "a silent omission is how somebody concludes a file is lost");

    const loud = collect();
    await ls({ server: BASE, network: "testnet", all: true, write: loud.write });
    assert.match(loud.lines.join("\n"), /gone\.txt.*\[trash\]/);
  });
});

test("⛔ a list that goes backwards is refused, not listed", async () => {
  await withSandbox("ls-rollback", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(code, [entry({ id: "f1", name: "new.txt" })], 9);
    await ls({ server: BASE, network: "testnet", write: collect().write });

    // …now the server offers an older one. Nothing about the blob is wrong; the VERSION is.
    await serveList(code, [entry({ id: "f1", name: "new.txt" })], 4);
    const failure = await ls({ server: BASE, network: "testnet", write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "an older list was accepted");
    assert.match(failure.message, /\b9\b/);
    assert.match(failure.message, /\b4\b/);
  });
});

test("a first listing says that nothing here could have caught a rollback", async () => {
  await withSandbox("ls-firstrun", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(code, [entry({ id: "f1", name: "a.txt" })], 1);
    const first = collect();
    await ls({ server: BASE, network: "testnet", write: first.write });
    assert.match(first.lines.join("\n"), /First listing on this machine/);

    const second = collect();
    await ls({ server: BASE, network: "testnet", write: second.write });
    assert.ok(!second.lines.join("\n").includes("First listing"), "said twice, it is noise");
  });
});

test("⛔ a list sealed by a different account is refused, not shown as empty", async () => {
  await withSandbox("ls-wrongkey", async () => {
    const mine = await generateCode();
    const theirs = await generateCode();
    process.env[CODE_ENV_VAR] = mine;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(theirs, [entry({ id: "f1", name: "not-mine.txt" })], 1);
    const failure = await ls({ server: BASE, network: "testnet", write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "someone else's list opened, or read as empty");
    assert.match(failure.message, /did not open/);
  });
});

test("⛔ one version number cannot be two lists — a fork is refused", async () => {
  await withSandbox("ls-fork", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(code, [entry({ id: "f1", name: "left.txt" })], 5);
    await ls({ server: BASE, network: "testnet", write: collect().write });

    // Same version, different contents: two devices being shown different histories.
    await serveList(code, [entry({ id: "f2", name: "right.txt" })], 5);
    const failure = await ls({ server: BASE, network: "testnet", write: collect().write }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "two different lists at one version were both accepted");
    assert.match(failure.message, /same version/);
  });
});

test("the same list served twice is not mistaken for a fork", async () => {
  await withSandbox("ls-samelist", async () => {
    const code = await generateCode();
    process.env[CODE_ENV_VAR] = code;
    process.env[API_KEY_ENV_VAR] = KEY;
    await serveList(code, [entry({ id: "f1", name: "steady.txt" })], 5);
    await ls({ server: BASE, network: "testnet", write: collect().write });
    const out = collect();
    assert.equal(await ls({ server: BASE, network: "testnet", write: out.write }), 0);
    assert.match(out.lines.join("\n"), /steady\.txt/);
  });
});

// `nmts recovery-list` — the artefact that exists for the day this service does not.
//
// ⛔ THE ASSERTIONS OPEN WHAT WAS WRITTEN. A file that says the right things in its header and
//    carries bytes nothing can open is worse than no file: somebody keeps it for years believing
//    they are covered. So the tests take the `sealed` field out of the document, open it with the
//    account code at the offsets the format document names, and check what is inside.
//
// ⛔ AND THE REFUSALS ARE CHECKED BY WHAT IS ON THE DISK AFTERWARDS, not by the message. "No
//    partial list" is a claim about a directory, so the directory is what gets read.

import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { accountProofFor } from "../src/account-proof.ts";
import { request, ServerError } from "../src/api.ts";
import { recoveryList } from "../src/commands/recovery-list.ts";
import { testConfigDir, CODE_ENV_VAR } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { entry, folder, KEY } from "./fake-drive.ts";
import {
  authSecretOf,
  lines,
  openRecoveryList,
  part,
  sealUnderDataKey,
  startFakeRecovery,
  withAccount,
  type SourceItemRow,
} from "./fake-recovery.ts";

const fake = await startFakeRecovery();
after(() => fake.close());

const opts = (out: { write: (line: string) => void }, dir: string) => ({
  server: fake.base,
  network: "testnet",
  out: dir,
  write: out.write,
});

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "nmts-reclist-"));
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function rows(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "expected an array");
  return value;
}

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

/** A file the account really holds: a real wrapped key and a real sealed content hash. */
async function storedFile(
  code: string,
  over: { id: string; name: string; parentId?: string | null; size: number },
): Promise<ManifestEntry> {
  const dek = new Uint8Array(32).fill(7);
  const hash = new Uint8Array(32).fill(9);
  return entry({
    id: over.id,
    name: over.name,
    parentId: over.parentId ?? null,
    size: over.size,
    dekWrapped: await sealUnderDataKey(code, "nmts/v3/dek-wrap", dek),
    contentHashCt: await sealUnderDataKey(code, "nmts/v3/content-hash", hash),
  });
}

function storedRow(id: string, plaintextLens: readonly number[]): SourceItemRow {
  return {
    id,
    size: plaintextLens.reduce((n, v) => n + v, 0),
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-02T11:00:00Z",
    parts: plaintextLens.map((len, i) => part({ part_index: i, plaintextLen: len })),
  };
}

test("a multi-page walk describes every file, and the sealed list opens with the account code", async () => {
  await withAccount(fake, "reclist-pages", async (code) => {
    const photos = folder({ id: "f1", name: "photos" });
    await fake.serve(code, [
      photos,
      await storedFile(code, { id: "a1", name: "budget.xlsx", size: 40 }),
      await storedFile(code, { id: "a2", name: "holiday.jpg", parentId: "f1", size: 90 }),
      await storedFile(code, { id: "a3", name: "notes.md", size: 5 }),
    ]);
    fake.source = [storedRow("a1", [40]), storedRow("a2", [50, 40]), storedRow("a3", [5])];
    // ⛔ Two per page, so the walk has to ask three times. A single-page fixture cannot fail for a
    //    reader that stops at the first one.
    fake.pageSize = 2;

    const dir = scratch();
    try {
      const out = lines();
      assert.equal(await recoveryList(opts(out, dir)), 0, out.out.join("\n"));

      const identity = await identityOf(code);
      const slug = identity.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      const name = `nmts-recovery-map-${slug}-0001.nmtsmap`;
      assert.deepEqual(readdirSync(dir), [name], "one file, under the name the format describes");

      const written = join(dir, name);
      assert.equal(statSync(written).mode & 0o777, 0o600, "the list was not written 0600");

      const doc: unknown = JSON.parse(readFileSync(written, "utf8"));
      assert.equal(field(doc, "format"), "nmts-recovery-map", "a reader matches on this string");
      assert.equal(field(doc, "version"), 2);
      assert.equal(field(doc, "nrm"), 2, "no v3 or v4 form is used, so it must stay readable by 0.1.0");
      assert.equal(field(doc, "seq"), 1);
      assert.equal(field(doc, "account_id"), identity.accountId);
      assert.equal(field(doc, "min_tool"), "0.1.0");
      assert.ok(rows(field(doc, "note")).length > 0, "a finder is told nothing");
      const about = field(doc, "about");
      assert.equal(field(about, "artifact"), "recovery-list");
      assert.equal(field(field(about, "sealed"), "context"), "nmts/v3/recovery-map");
      assert.match(String(field(about, "app_version")), /nmts-cli/);
      // ⛔ NOTHING IN THE PLAINTEXT HEADER NAMES OR COUNTS WHAT IS INSIDE.
      const header = readFileSync(written, "utf8");
      for (const secret of ["budget.xlsx", "holiday.jpg", "notes.md", code]) {
        assert.ok(!header.includes(secret), `the plaintext header leaked ${secret}`);
      }

      const sealed = field(doc, "sealed");
      assert.equal(typeof sealed, "string");
      const list = await openRecoveryList(code, String(sealed));
      const items = rows(field(list, "items"));
      assert.equal(items.length, 3, "a page was dropped — every file must be described");
      assert.deepEqual(
        items.map((i) => field(i, "name")),
        ["budget.xlsx", "holiday.jpg", "notes.md"],
      );
      assert.deepEqual(
        items.map((i) => field(i, "path")),
        ["/", "/photos", "/"],
      );
      const multi = items[1];
      assert.equal(field(multi, "size"), 90);
      const parts = rows(field(multi, "parts"));
      assert.deepEqual(parts.map((p) => field(p, "part_index")), [0, 1]);
      assert.deepEqual(parts.map((p) => field(p, "plaintext_len")), [50, 40]);
      assert.deepEqual(parts.map((p) => field(p, "network")), ["walrus", "walrus"]);
      // The file key is the RAW 32 bytes, not the envelope the server holds.
      assert.equal(
        field(multi, "dek"),
        Buffer.alloc(32, 7).toString("base64url"),
        "the list must carry the opened key, not the wrapped one",
      );
      assert.equal(field(multi, "content_hash"), Buffer.alloc(32, 9).toString("base64url"));
      assert.equal(field(list, "prev_manifest_blob_id"), null);
      assert.equal(field(field(field(list, "meta"), "storage"), "chain"), "testnet");
      assert.deepEqual(field(field(list, "meta"), "totals"), { items: 3, bytes: 135 });

      // ⛔ AND THE SERVER WAS TOLD. Without this the account screen goes on saying no list exists.
      assert.equal(fake.recorded.length, 1, out.out.join("\n"));
      assert.equal(field(fake.recorded[0], "kind"), "local");
      assert.equal(field(fake.recorded[0], "seq"), 1);
      assert.equal(typeof field(fake.recorded[0], "captured_at"), "string");
      assert.equal(field(fake.recorded[0], "blob_id"), undefined, "a local list has no address");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("every request to a recovery route carries the proof a sign-in sends", async () => {
  await withAccount(fake, "reclist-proof", async (code) => {
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 4 })]);
    fake.source = [storedRow("a1", [4])];

    const dir = scratch();
    try {
      const out = lines();
      assert.equal(await recoveryList(opts(out, dir)), 0, out.out.join("\n"));
      const expected = await authSecretOf(code);
      assert.ok(fake.proofs.length >= 2, "the dump and the record are two requests");
      for (const offered of fake.proofs) {
        assert.equal(offered, expected, "a recovery route was asked without the account proof");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ without the proof the server refuses, and the refusal says what to do about it", async () => {
  await withAccount(fake, "reclist-noproof", async (code) => {
    await fake.serve(code, []);
    const failure = await refusal(
      request(fake.base, "/v1/account/recovery-source", { token: KEY }),
    );
    assert.ok(failure instanceof ServerError, "the refusal lost its code");
    assert.equal(failure.code, "ACCOUNT_PROOF_REQUIRED");
    assert.match(String(failure.nextStep), /proof of the account code/);
  });
});

test("⛔ a stored file whose parts are misnumbered produces NO file rather than a partial one", async () => {
  await withAccount(fake, "reclist-misnumbered", async (code) => {
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 80 })]);
    // Part 0 and part 2: a complete run of two would be 0 and 1, so a row has been repeated,
    // dropped, or shifted — none of which an honest server produces.
    fake.source = [
      {
        id: "a1",
        size: 80,
        created_at: "2026-08-01T10:00:00Z",
        updated_at: "2026-08-01T10:00:00Z",
        parts: [part({ part_index: 0, plaintextLen: 40 }), part({ part_index: 2, plaintextLen: 40 })],
      },
    ];

    const dir = scratch();
    try {
      const out = lines();
      const failure = await refusal(recoveryList(opts(out, dir)));
      assert.match(failure.message, /not a complete set|was not written/);
      assert.deepEqual(readdirSync(dir), [], "a partial list was written");
      assert.equal(fake.recorded.length, 0, "the server was told about a list that does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ parts that do not add up to the size in the sealed file list produce NO file", async () => {
  await withAccount(fake, "reclist-short", async (code) => {
    // The file list says 200 bytes; the dump offers two parts of 40. The file list is sealed under
    // the account key and the server cannot write it, which is what makes its number the one to
    // believe — so this is a truncated tail, not a smaller file.
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 200 })]);
    fake.source = [storedRow("a1", [40, 40])];

    const dir = scratch();
    try {
      const out = lines();
      const failure = await refusal(recoveryList(opts(out, dir)));
      assert.match(failure.message, /do not add up/);
      // ⛔ AND THE SIZE ITSELF IS NOT IN THE SENTENCE: a plaintext length is a value the server is
      //    not told, and an agent copies error strings into logs.
      assert.ok(!failure.message.includes("200"), "the refusal printed the file's real size");
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ a stored file the sealed file list does not describe produces NO file", async () => {
  await withAccount(fake, "reclist-orphan", async (code) => {
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 4 })]);
    fake.source = [storedRow("a1", [4]), storedRow("ghost", [4])];

    const dir = scratch();
    try {
      const out = lines();
      const failure = await refusal(recoveryList(opts(out, dir)));
      assert.match(failure.message, /missing from your file list/);
      assert.deepEqual(readdirSync(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ the proof is not built from a plain environment variable without the agreement", async () => {
  const dir = testConfigDir("reclist-consent");
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  try {
    // Nothing is granted in this directory, which is where every machine starts.
    const failure = await refusal(accountProofFor({ code: "irrelevant", source: "env" }));
    assert.equal(failure.exitCode, 5, "an ungranted agreement is exit 5");
    assert.match(String(failure.nextStep), /consent grant plain-env/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (before.dir === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = before.dir;
    if (before.code === undefined) delete process.env[CODE_ENV_VAR];
    else process.env[CODE_ENV_VAR] = before.code;
  }
});

test("a padded part is recorded as two numbers, and the document says it needs a newer reader", async () => {
  await withAccount(fake, "reclist-padded", async (code) => {
    // The file holds 40 bytes; its stored stream was sealed from 64 — the next power of two, one
    // of the lengths this build's own padding rules produce. Both numbers have to survive: the
    // real one is what a recovery writes out, the declared one is what it checks the fetched
    // header against.
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 40 })]);
    fake.source = [
      {
        id: "a1",
        size: 64,
        created_at: "2026-08-01T10:00:00Z",
        updated_at: "2026-08-01T10:00:00Z",
        parts: [part({ part_index: 0, plaintextLen: 64 })],
      },
    ];

    const dir = scratch();
    try {
      const out = lines();
      assert.equal(await recoveryList(opts(out, dir)), 0, out.out.join("\n"));
      const written = join(dir, readdirSync(dir)[0] ?? "");
      const doc: unknown = JSON.parse(readFileSync(written, "utf8"));
      // ⛔ THE VERSION IS A CEILING IN EVERY PUBLISHED READER, so a padded list must declare 4 —
      //    and an ordinary one must NOT, or every build already in somebody's hands refuses it.
      assert.equal(field(doc, "nrm"), 4, "a padded part is a v4 form");
      assert.equal(field(doc, "min_tool"), "0.2.0", "the version a person can go and download");

      const list = await openRecoveryList(code, String(field(doc, "sealed")));
      const first = rows(field(list, "items"))[0];
      assert.equal(field(first, "size"), 40, "the list must state the file's REAL size");
      const parts = rows(field(first, "parts"));
      assert.equal(field(parts[0], "plaintext_len"), 40, "what the part contributes");
      assert.equal(field(parts[0], "padded_len"), 64, "what its stored header declares");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

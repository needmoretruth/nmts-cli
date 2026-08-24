// `nmts listfile` — the copy of the sealed file list a person keeps on their own disk.
//
// ⛔ THE ASSERTIONS OPEN WHAT WAS WRITTEN. A file that says the right things in its header and
//    carries bytes nothing can open is worse than no file: somebody keeps it for years believing
//    they are covered. So one test takes the `sealed` field out of the document, opens it with the
//    account code, and checks the entries are the ones the account had.
//
// ⛔ AND ONE TEST READS THE FILE LOOKING FOR WHAT MUST NOT BE IN IT. This artefact is meant to be
//    kept somewhere ordinary — another machine, a backup drive — so a plaintext file name or, far
//    worse, the account code leaking into it would turn a safety copy into a liability.

import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { listfile } from "../src/commands/listfile.ts";
import { ls } from "../src/commands/ls.ts";
import { LIST_FILE_EXTENSION, LIST_FILE_FORMAT } from "../src/list-file.ts";
import { readKeptList, recordWrittenList } from "../src/manifest.ts";
import { NmtsError } from "../src/errors.ts";
import { entry } from "./fake-drive.ts";
import { openFileList } from "./helpers.ts";
import { lines, startFakeItems, withAccount } from "./fake-items.ts";

const fake = await startFakeItems();
after(() => fake.close());

const server = (out: { write: (line: string) => void }) => ({
  server: fake.base,
  network: "testnet",
  write: out.write,
});

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

/** A directory of this test's own to write into. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "nmts-listfile-"));
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

test("a read keeps the sealed list, and the command writes it out in the shared format", async () => {
  await withAccount(fake, "listfile-writes", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" }), entry({ id: "b", name: "notes.md" })]);
    await ls(server(lines()));

    const dir = scratch();
    try {
      const out = lines();
      assert.equal(await listfile({ out: dir, write: out.write }), 0, out.out.join("\n"));

      const identity = await identityOf(code);
      const slug = identity.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      const name = `nmts-file-list-${slug}-0001.${LIST_FILE_EXTENSION}`;
      const text = readFileSync(join(dir, name), "utf8");
      const doc: unknown = JSON.parse(text);

      assert.equal(field(doc, "format"), LIST_FILE_FORMAT, "a reader matches on this string");
      assert.equal(field(doc, "version"), 1);
      assert.equal(field(doc, "seq"), 1);
      assert.equal(field(doc, "account_id"), identity.accountId);
      assert.equal(field(doc, "sealed"), fake.servedCt(), "the bytes are not the ones the server served");
      assert.ok(Array.isArray(field(doc, "note")) && (field(doc, "note") as unknown[]).length > 0);

      const about = field(doc, "about");
      assert.equal(field(about, "artifact"), "file-list");
      assert.equal(field(about, "product"), "NMTS");
      assert.equal(field(field(about, "sealed"), "context"), "nmts/v3/file-list", "the separator a reader must pass");
      assert.equal(field(field(about, "sealed"), "opened_with"), "nmts-account-code");
      assert.match(String(field(about, "app_version")), /nmts-cli/, "the file does not say what wrote it");

      // ⛔ The bytes have to OPEN. Everything above could be right about a file nobody can use.
      const sealed = field(doc, "sealed");
      assert.equal(typeof sealed, "string");
      const recovered = await openFileList(code, String(sealed));
      assert.deepEqual(recovered.map((e) => e.name).sort(), ["budget.xlsx", "notes.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ the file carries neither the account code nor any plaintext name", async () => {
  await withAccount(fake, "listfile-leaks", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "severance-agreement.pdf" })]);
    await ls(server(lines()));

    const dir = scratch();
    try {
      await listfile({ out: dir, write: lines().write });
      const identity = await identityOf(code);
      const slug = identity.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      const text = readFileSync(join(dir, `nmts-file-list-${slug}-0001.${LIST_FILE_EXTENSION}`), "utf8");

      assert.ok(!text.includes(code), "⛔ the account code is in the file — this plus the code IS the account");
      assert.ok(
        !text.includes(identity.displayCode),
        "⛔ the account code, in its readable spelling, is in the file",
      );
      assert.ok(!text.includes("severance"), "a file name reached the plaintext part of the wrapper");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ a machine that has never read the list is told so, and writes nothing", async () => {
  await withAccount(fake, "listfile-none", async () => {
    const dir = scratch();
    try {
      const error = await refusal(listfile({ out: dir, write: lines().write }));
      assert.equal(error.exitCode, 4);
      assert.match(String(error.nextStep), /nmts ls/, "it did not say how to get a copy");
      assert.deepEqual(readdirSync(dir), [], "it wrote something while refusing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("it will not replace a file that is already there, and --force is what does", async () => {
  await withAccount(fake, "listfile-force", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    await ls(server(lines()));
    const dir = scratch();
    const target = join(dir, "copy.nmtslist");
    try {
      writeFileSync(target, "older copy\n");
      const error = await refusal(listfile({ out: target, write: lines().write }));
      assert.equal(error.exitCode, 4);
      assert.equal(readFileSync(target, "utf8"), "older copy\n", "it overwrote a file nobody told it to");

      assert.equal(await listfile({ out: target, force: true, write: lines().write }), 0);
      assert.match(readFileSync(target, "utf8"), /"format": "nmts-file-list"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("`--out -` puts the document on standard output and every word for a person elsewhere", async () => {
  await withAccount(fake, "listfile-stdout", async (code) => {
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    await ls(server(lines()));

    const said = lines();
    const document: string[] = [];
    assert.equal(await listfile({ out: "-", write: said.write, writeDocument: (t) => document.push(t) }), 0);

    const doc: unknown = JSON.parse(document.join(""));
    assert.equal(field(doc, "format"), LIST_FILE_FORMAT);
    assert.ok(said.out.length > 0, "it said nothing about what the file is");
    // ⚠ The filename is fair game in either stream; what must not be there is the DOCUMENT — a
    //   line of it on the same stream would make `… --out - > copy` a file with words glued on.
    const words = said.out.join("\n");
    assert.ok(!words.includes('"format"'), "part of the document went to the stream a person reads");
    assert.ok(!words.includes(String(field(doc, "sealed"))), "the sealed bytes went to the wrong stream");
  });
});

// ── the copy tracks the list ──────────────────────────────────────────────────────────────────

test("⛔ a newer version replaces the copy, and an older one never does", async () => {
  await withAccount(fake, "listfile-newer", async (code) => {
    const identity = await identityOf(code);
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" })]);
    await ls(server(lines()));
    const first = readKeptList(identity.accountId);
    assert.equal(first?.seq, 1);

    // Another device writes version 2; this machine reads it and its copy moves on.
    await fake.serve(code, [entry({ id: "a", name: "budget.xlsx" }), entry({ id: "b", name: "notes.md" })], 2);
    await ls(server(lines()));
    const second = readKeptList(identity.accountId);
    assert.equal(second?.seq, 2);
    assert.equal(second?.ct, fake.servedCt());
    assert.equal((await openFileList(code, String(second?.ct))).length, 2);

    // ⛔ And an older blob does not push the newer copy out. The record of what this machine has
    //    seen can be lost or cleared; the copy must not be talked backwards when it is.
    assert.ok(first !== null);
    await recordWrittenList(identity.accountId, 1, first.ct);
    assert.equal(readKeptList(identity.accountId)?.seq, 2, "an older list overwrote a newer copy");
  });
});

// `nmts terms` and `nmts privacy` against a real local server.
//
// ⛔ THE LANGUAGE AND THE DOCUMENT ARE BOTH ASSERTED, because getting either wrong is silent. The
//    route reads anything that is not `ko` as English, so a tool that mis-spelled the option would
//    hand somebody the wrong version of a legal document while looking like it worked — and the
//    two are not interchangeable to whoever has to rely on one.
//
// ⛔ AND THE SAVED FILE CARRIES THE VERSION, from the server's own header. A copy whose name does
//    not say which version it is cannot be told apart from the next one, which is the whole point
//    of keeping it.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { legal } from "../src/commands/documents.ts";
import { NmtsError } from "../src/errors.ts";
import { collect, startFakeDrive } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (out: { write: (line: string) => void }) => ({ server: drive.base, write: out.write });

test("the terms print as the text the server publishes", async () => {
  const out = collect();
  assert.equal(await legal("terms", opts(out)), 0);
  assert.deepEqual(out.lines, ["# NMTS Terms of Service\n\nVersion 12. Effective 2026-09-10."]);
});

test("the privacy policy is its own document, not the terms", async () => {
  const out = collect();
  assert.equal(await legal("privacy", opts(out)), 0);
  assert.deepEqual(out.lines, ["# NMTS Privacy Policy\n\nVersion 11. Effective 2026-09-10."]);
});

test("--lang ko asks for the Korean version and gets it", async () => {
  const out = collect();
  assert.equal(await legal("terms", { ...opts(out), lang: "ko" }), 0);
  assert.deepEqual(out.lines, ["# NMTS Terms of Service (Korean edition)\n\nVersion 12."]);
  assert.ok(
    drive.calls.some((c) => c === "GET /api/legal/terms?lang=ko"),
    `the language never reached the server: ${drive.calls.join(" · ")}`,
  );
});

test("--board asks for the message board's terms", async () => {
  const out = collect();
  assert.equal(await legal("terms", { ...opts(out), board: true }), 0);
  assert.deepEqual(out.lines, ["# NMTS Board Terms\n\nVersion 4."]);
});

test("--board on the privacy policy is refused rather than quietly ignored", async () => {
  const out = collect();
  await assert.rejects(
    () => legal("privacy", { ...opts(out), board: true }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /--board belongs to the terms/);
      return true;
    },
  );
});

test("a language this service has no version in is refused, not silently answered in English", async () => {
  const out = collect();
  await assert.rejects(
    () => legal("terms", { ...opts(out), lang: "fr" }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      assert.match(error.nextStep ?? "", /--lang takes en or ko/);
      return true;
    },
  );
});

test("--save writes the versioned name the server gave it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-legal-"));
  try {
    const out = collect();
    assert.equal(await legal("privacy", { ...opts(out), save: true, out: dir }), 0);
    const expected = join(dir, "nmts-privacy-11.en.md");
    assert.deepEqual(out.lines, [`Wrote ${expected}`]);
    assert.equal(readFileSync(expected, "utf8"), "# NMTS Privacy Policy\n\nVersion 11. Effective 2026-09-10.\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--save will not write over a copy already kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-legal-"));
  try {
    const taken = join(dir, "nmts-terms-12.en.md");
    writeFileSync(taken, "the version somebody kept");
    const out = collect();
    await assert.rejects(
      () => legal("terms", { ...opts(out), save: true, out: dir }),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 4);
        assert.ok(error.message.includes(taken), "the refusal does not name the path");
        return true;
      },
    );
    assert.equal(readFileSync(taken, "utf8"), "the version somebody kept");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nothing here opens a session or sends a credential", async () => {
  // ⛔ THE PUBLIC DOCUMENTS ARE PUBLIC. A tool that reached for a credential to read the terms
  //    would fail for an account that has none, and would tell the server who was reading.
  const out = collect();
  assert.equal(await legal("terms", opts(out)), 0);
  assert.deepEqual(
    drive.calls.filter((c) => !c.startsWith("GET /api/")),
    [],
    "reading a public document called something other than the document routes",
  );
});

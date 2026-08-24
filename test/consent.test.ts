// The few things this tool stops for, and the many it does not.

import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CONSENTS,
  CONSENT_KEYS,
  grant,
  grantedAt,
  isGranted,
  requireConsent,
  revoke,
} from "../src/consent.ts";
import { consent } from "../src/commands/consent.ts";
import { NmtsError } from "../src/errors.ts";
import { codeStorageIsPrivate, modesAreEnforced } from "../src/credentials.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-consent-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

const AT = new Date("2026-08-23T18:00:00.000Z");

test("⛔ there are five keys, and each one is irreversible, costs money, or moves the code", () => {
  // The bar for a key existing is the whole design: a tool that asks about everything trains
  // people to say yes without reading. If this list grows, that reason has to grow with it.
  //
  // ⭐ `plain-env` joined on 2026-08-23. It is not a smaller version of `unsafe-code-storage`:
  //    that one is about a FILE this tool writes, and this one is about an environment variable,
  //    which leaks through `docker inspect`, /proc/<pid>/environ, child processes and CI logs —
  //    channels a 0600 file has none of.
  // ⭐ `share` joined on 2026-08-24, and it is the first one whose risk is not this account's.
  //    Spending costs the holder money; storing the code badly endangers the holder's own files.
  //    Sharing hands a file to a third party, and the undo — withdrawing the share — reaches
  //    nothing they already fetched. A key exists for that gap because it cannot be closed later.
  assert.deepEqual(CONSENT_KEYS, ["spend", "unsafe-code-storage", "plain-env", "share", "wallet"]);
});

test("every key says what it does, what can go wrong, and what it does not cover", () => {
  for (const key of CONSENT_KEYS) {
    const c = CONSENTS[key];
    for (const [field, text] of Object.entries(c)) {
      assert.ok(text.length > 20, `${key}.${field} is too short to be an explanation`);
      assert.match(text, /\.$/, `${key}.${field} is not a sentence`);
    }
  }
});

test("nothing is agreed to until it is agreed to", () => {
  const dir = isolate();
  try {
    for (const key of CONSENT_KEYS) assert.equal(isGranted(key), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a grant is remembered across runs, with the date", () => {
  const dir = isolate();
  try {
    grant("spend", "1.2.3", AT);
    assert.equal(grantedAt("spend"), "2026-08-23T18:00:00.000Z");
    assert.equal(isGranted("spend"), true);
    assert.equal(isGranted("wallet"), false, "agreeing to one thing agrees to one thing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the record is not readable by other users on this machine", { skip: !modesAreEnforced() }, () => {
  const dir = isolate();
  try {
    grant("spend", "1.2.3", AT);
    const mode = statSync(join(dir, "consent.json")).mode & 0o777;
    assert.equal(mode & 0o077, 0, `consent.json is mode ${mode.toString(8)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a grant can be taken back", () => {
  const dir = isolate();
  try {
    grant("wallet", "1.2.3", AT);
    revoke("wallet");
    assert.equal(isGranted("wallet"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the refusal names the risk, the limit, and the one command that agrees", () => {
  const dir = isolate();
  try {
    assert.throws(
      () => requireConsent("spend"),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 5, "its own exit code, so a program can tell it apart");
        const step = error.nextStep ?? "";
        assert.match(step, /not refundable/, "the risk is stated");
        assert.match(step, /nmts consent grant spend/, "the exact command is given");
        assert.match(step, /not responsible/, "what NMTS does not cover is said before it matters");
        assert.match(step, /Do not run the grant command yourself/, "the rule for an agent is stated");
        assert.match(step, /nmts@nmts\.me/, "where to write if this is wrong");
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("once agreed, it does not ask again — an agent doing fifty files is asked once", () => {
  const dir = isolate();
  try {
    grant("spend", "1.2.3", AT);
    for (let i = 0; i < 50; i += 1) requireConsent("spend");
    assert.ok(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ an unreadable record counts as NOT agreed", async () => {
  const dir = isolate();
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "consent.json"), "{ this is not json", { mode: 0o600 });
    assert.equal(isGranted("spend"), false, "a record that switches itself on when broken is not a record");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`consent` lists every key and says which are agreed", () => {
  const dir = isolate();
  try {
    grant("spend", "1.2.3", AT);
    const lines: string[] = [];
    assert.equal(consent(undefined, undefined, { write: (l) => lines.push(l) }), 0);
    const text = lines.join("\n");
    for (const key of CONSENT_KEYS) assert.match(text, new RegExp(key));
    assert.match(text, /agreed .*spend/s);
    assert.match(text, /not agreed {2}wallet/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`consent --json` is one document a program can read", () => {
  const dir = isolate();
  try {
    grant("wallet", "1.2.3", AT);
    const lines: string[] = [];
    consent(undefined, undefined, { json: true, write: (l) => lines.push(l) });
    const parsed: unknown = JSON.parse(lines.join(""));
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, CONSENT_KEYS.length);
    const wallet = parsed.find((row: { key: string }) => row.key === "wallet");
    assert.equal(wallet.granted, true);
    assert.equal(wallet.grantedAt, "2026-08-23T18:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a name that is not a key is refused with the list, not a shrug", () => {
  const dir = isolate();
  try {
    assert.throws(() => consent("grant", "everything", { write: () => {} }), /nothing called "everything"/);
    assert.throws(() => consent("grant", undefined, { write: () => {} }), /Say which one/);
    assert.throws(() => consent("enable", "spend", { write: () => {} }), /Unknown/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("whether the code can be stored privately is MEASURED, not assumed from the platform", () => {
  const dir = isolate();
  try {
    // On this machine it should be true; the value that matters is that asking does not throw and
    // does not leave the probe behind.
    const answer = codeStorageIsPrivate();
    assert.equal(typeof answer, "boolean");
    assert.equal(answer, modesAreEnforced(), "an ordinary POSIX temp directory keeps a mode");
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.includes("mode-probe")),
      [],
      "the probe file was left behind",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The locks: what is declared, what a lock says, how one is opened and closed, and what a locked
// act's refusal tells the person.

import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONSENTS, CONSENT_KEYS, grant, grantedAt, isGranted, requireConsent, revoke } from "../src/consent.ts";
import { unlock } from "../src/commands/unlock.ts";
import { NmtsError } from "../src/errors.ts";
import { codeStorageIsPrivate, modesAreEnforced } from "../src/credentials.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-consent-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

const AT = new Date("2026-08-23T18:00:00.000Z");
const yes = async (_q: string) => "y";

test("⛔ the locks are exactly these, and each guards something irreversible, unbounded, or the code", () => {
  // The bar for a lock: it cannot be undone · money without a ceiling · the NMTS key leaves
  // the sealed file · something reaches a third party. Credits left the list on 2026-09-06: they
  // are bounded by the server's daily ceiling, so spending them is a medium act the gate asks
  // about, not a lock.
  assert.deepEqual(CONSENT_KEYS, [
    "unsafe-code-storage",
    "plain-env",
    "share",
    "wallet",
    "sign-out",
    "rollback",
    "reveal",
    "kit",
    "donate",
    "release-storage",
  ]);
});

test("every lock says what it guards, what can go wrong, and what it does not cover", () => {
  for (const key of CONSENT_KEYS) {
    const c = CONSENTS[key];
    for (const [field, text] of Object.entries(c)) {
      assert.ok(text.length > 20, `${key}.${field} is too short to be an explanation`);
      assert.match(text, /\.$/, `${key}.${field} is not a sentence`);
    }
  }
});

test("nothing is unlocked until it is unlocked", () => {
  const dir = isolate();
  try {
    for (const key of CONSENT_KEYS) assert.equal(isGranted(key), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unlock is remembered across runs, with the date", () => {
  const dir = isolate();
  try {
    grant("reveal", "1.2.3", AT);
    assert.equal(grantedAt("reveal"), "2026-08-23T18:00:00.000Z");
    assert.equal(isGranted("reveal"), true);
    assert.equal(isGranted("kit"), false, "one unlock opened another");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the record is not readable by other users on this machine", { skip: !modesAreEnforced() }, () => {
  const dir = isolate();
  try {
    grant("reveal", "1.2.3", AT);
    const file = join(dir, "consent.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a lock can be closed again", () => {
  const dir = isolate();
  try {
    grant("reveal", "1.2.3", AT);
    revoke("reveal");
    assert.equal(isGranted("reveal"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the refusal names the risk, the limit, and the one command that unlocks", () => {
  const dir = isolate();
  try {
    assert.throws(
      () => requireConsent("reveal"),
      (error: unknown) => {
        assert.ok(error instanceof NmtsError);
        assert.equal(error.exitCode, 5);
        const step = String(error.nextStep);
        assert.match(step, /nmts unlock reveal/, "the exact command is given");
        assert.match(step, /show it to them/i, "an agent is told to hand the question to the person");
        assert.ok(step.includes(CONSENTS.reveal.risk));
        assert.ok(step.includes(CONSENTS.reveal.limit));
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ unlocking needs a terminal; locking never does", async () => {
  const dir = isolate();
  try {
    await assert.rejects(
      () => unlock("unlock", "reveal", { write: () => {} }),
      (e: unknown) => {
        assert.ok(e instanceof NmtsError);
        assert.equal(e.exitCode, 5);
        assert.match(e.nextStep ?? "", /do not unlock/);
        return true;
      },
    );
    assert.equal(isGranted("reveal"), false, "it unlocked without a terminal");
    const said: string[] = [];
    assert.equal(await unlock("unlock", "reveal", { write: (l) => said.push(l), readLine: yes }), 0);
    assert.equal(isGranted("reveal"), true);
    assert.ok(said[0]?.startsWith(CONSENTS.reveal.what), "the lock was not explained before the question");
    assert.equal(await unlock("unlock", "kit", { write: () => {}, readLine: async () => "" }), 1);
    assert.equal(isGranted("kit"), false, "an empty answer unlocked");
    assert.equal(await unlock("lock", "reveal", { write: () => {} }), 0);
    assert.equal(isGranted("reveal"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ an unreadable record counts as LOCKED", async () => {
  const dir = isolate();
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "consent.json"), "{ not json");
    assert.equal(isGranted("reveal"), false, "a record that switches itself on when broken is not a record");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`unlock` lists every lock and says which are open", async () => {
  const dir = isolate();
  try {
    grant("reveal", "1.2.3", AT);
    const lines: string[] = [];
    assert.equal(await unlock(undefined, undefined, { write: (l) => lines.push(l), now: () => AT }), 0);
    const text = lines.join("\n");
    for (const key of CONSENT_KEYS) assert.match(text, new RegExp(`\\b${key}\\b`));
    assert.match(text, /unlocked {2}\s+reveal/);
    assert.match(text, /locked {4}\s+kit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`unlock --json` is one document a program can read", async () => {
  const dir = isolate();
  try {
    grant("reveal", "1.2.3", AT);
    const lines: string[] = [];
    assert.equal(await unlock(undefined, undefined, { json: true, write: (l) => lines.push(l), now: () => AT }), 0);
    const parsed: unknown = JSON.parse(lines.join(""));
    assert.ok(Array.isArray(parsed));
    const reveal = parsed.find((r: { key: string }) => r.key === "reveal");
    assert.deepEqual(reveal?.unlocked, true);
    assert.equal(reveal?.unlockedAt, "2026-08-23T18:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a name that is not a lock is refused with the list, not a shrug", async () => {
  const dir = isolate();
  try {
    await assert.rejects(() => unlock("unlock", "everything", { write: () => {}, readLine: yes }), /nothing called "everything"/);
    await assert.rejects(() => unlock("enable", "reveal", { write: () => {} }), /Unknown/);
    assert.equal(readdirSync(dir).length, 0, "a refused request wrote a record");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("whether the code can be stored privately is MEASURED, not assumed from the platform", () => {
  const dir = isolate();
  try {
    assert.equal(typeof codeStorageIsPrivate(), "boolean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

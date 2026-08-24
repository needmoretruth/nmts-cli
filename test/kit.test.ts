// `nmts kit` — the one file that carries everything, account code included.
//
// ⛔ THE TESTS TREAT THIS FILE AS DANGEROUS, BECAUSE IT IS. What they check is not that a kit was
//    produced but that the account code went to exactly one place: the path the caller named, at
//    0600, and nowhere else — not into this tool's own directory, not onto the terminal.
//
// ⛔ AND THAT AN EXISTING NAME IS A REFUSAL. Overwriting somebody's kit destroys the only copy of
//    an account code they may have, so the refusal is checked by reading the old file back.

import { strict as assert } from "node:assert";
import { mkdtempSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { kit } from "../src/commands/kit.ts";
import { configDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { KIT_DATA_BEGIN, KIT_DATA_END } from "../src/kit-file.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { entry } from "./fake-drive.ts";
import {
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
  return mkdtempSync(join(tmpdir(), "nmts-kit-"));
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

async function storedFile(
  code: string,
  over: { id: string; name: string; size: number },
): Promise<ManifestEntry> {
  return entry({
    id: over.id,
    name: over.name,
    size: over.size,
    dekWrapped: await sealUnderDataKey(code, "nmts/v3/dek-wrap", new Uint8Array(32).fill(3)),
    contentHashCt: await sealUnderDataKey(code, "nmts/v3/content-hash", new Uint8Array(32).fill(4)),
  });
}

function storedRow(id: string, len: number): SourceItemRow {
  return {
    id,
    size: len,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    parts: [part({ part_index: 0, plaintextLen: len })],
  };
}

/** Pull the machine block out the way the standalone program does: by the fixed markers. */
function machineBlock(text: string): unknown {
  const start = text.indexOf(KIT_DATA_BEGIN);
  assert.ok(start >= 0, "the kit carries no begin marker");
  const rest = text.slice(start + KIT_DATA_BEGIN.length);
  const end = rest.indexOf(KIT_DATA_END);
  assert.ok(end >= 0, "the kit carries no end marker");
  return JSON.parse(rest.slice(0, end).trim());
}

test("the kit is written 0600, carries the code, and holds the whole recovery list", async () => {
  await withAccount(fake, "kit-writes", async (code) => {
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "budget.xlsx", size: 40 })]);
    fake.source = [storedRow("a1", 40)];

    const dir = scratch();
    try {
      const out = lines();
      assert.equal(await kit(opts(out, dir)), 0, out.out.join("\n"));

      const identity = await identityOf(code);
      const slug = identity.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      const name = `nmts-recovery-kit-${slug}.txt`;
      assert.deepEqual(readdirSync(dir), [name]);

      const written = join(dir, name);
      // ⛔ THE MODE IS THE ONLY PROTECTION THIS FILE HAS. Every program running as you can read a
      //    0644 file, and what it would read is the account and the wallet.
      assert.equal(statSync(written).mode & 0o777, 0o600, "the kit was not written 0600");

      const text = readFileSync(written, "utf8");
      assert.ok(text.includes(identity.displayCode), "the kit does not carry the account code");
      assert.match(text, /Anyone who holds this file holds this account/);

      const data = machineBlock(text);
      assert.equal(field(data, "format"), "nmts-recovery-kit", "the marker a reader matches on");
      assert.equal(field(data, "version"), 2, "a higher number is refused by every published build");
      assert.equal(field(data, "account_id"), identity.accountId);
      assert.equal(field(data, "account_code"), identity.displayCode);
      assert.equal(field(data, "recovery_manifest_blob"), null, "this tool writes no network copy");
      assert.equal(field(field(data, "about"), "artifact"), "recovery-kit");
      assert.deepEqual(field(field(data, "about"), "contains"), ["account-code", "recovery-list"]);

      // The embedded list is the same document `recovery-list` writes, so one reader reads either.
      const embedded = field(data, "recovery_list");
      assert.equal(field(embedded, "format"), "nmts-recovery-map");
      assert.equal(field(embedded, "nrm"), 2);
      const list = await openRecoveryList(code, String(field(embedded, "sealed")));
      const items = field(list, "items");
      assert.ok(Array.isArray(items) && items.length === 1, "the embedded list is empty");
      assert.equal(field(items[0], "name"), "budget.xlsx");

      // ⛔ THE CODE WENT NOWHERE ELSE. Not to the terminal, and not into this tool's own directory.
      assert.ok(!out.out.join("\n").includes(identity.displayCode), "the kit printed the code");
      for (const kept of readdirSync(configDir())) {
        assert.ok(
          !readFileSync(join(configDir(), kept), "utf8").includes(identity.displayCode),
          `${kept} in the tool's own directory holds the account code`,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("⛔ a name that is taken is a refusal, and the file that was there is untouched", async () => {
  await withAccount(fake, "kit-no-overwrite", async (code) => {
    await fake.serve(code, [await storedFile(code, { id: "a1", name: "one.txt", size: 4 })]);
    fake.source = [storedRow("a1", 4)];

    const dir = scratch();
    try {
      const identity = await identityOf(code);
      const slug = identity.accountId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      const taken = join(dir, `nmts-recovery-kit-${slug}.txt`);
      writeFileSync(taken, "somebody else's kit\n", { mode: 0o600 });

      const out = lines();
      const failure = await refusal(kit(opts(out, dir)));
      assert.equal(failure.exitCode, 4);
      assert.match(String(failure.nextStep), /--force/);
      assert.equal(
        readFileSync(taken, "utf8"),
        "somebody else's kit\n",
        "the kit that was already there was overwritten",
      );

      // ⚠ And `--force` is what says the name is the caller's to replace.
      const second = lines();
      assert.equal(await kit({ ...opts(second, dir), force: true }), 0, second.out.join("\n"));
      assert.ok(readFileSync(taken, "utf8").includes(identity.displayCode));
      assert.equal(statSync(taken).mode & 0o777, 0o600, "a replaced kit lost its mode");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// `nmts platform`: what it writes, what it prints, and what it refuses.
//
// ⛔ THE ONE THAT MATTERS: the private half is in the file and on no screen. Everything else here
//    is a shape; this is the promise.

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { modesAreEnforced } from "../src/credentials.ts";
import { businessPublicKey } from "../src/platform-sign.ts";
import { platform } from "../src/commands/platform.ts";
import { NmtsError } from "../src/errors.ts";
import { assertModeWhereEnforced } from "./helpers.ts";

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "nmts-platform-"));
}

test("⛔ keygen writes both halves to a file only its owner can read, and prints only the public one", () => {
  const dir = sandbox();
  try {
    const out = join(dir, "keys.json");
    const lines: string[] = [];
    assert.equal(platform("keygen", { out, write: (l) => lines.push(l) }), 0);
    const parsed: unknown = JSON.parse(readFileSync(out, "utf8"));
    const publicKey = Reflect.get(parsed as object, "publicKey");
    const privateKey = Reflect.get(parsed as object, "privateKey");
    assert.equal(typeof privateKey, "string");
    assert.equal(businessPublicKey(String(privateKey)), publicKey, "the file's two halves are not a pair");
    const printed = lines.join("\n");
    assert.ok(printed.includes(String(publicKey)), "the public key was not printed");
    assert.ok(!printed.includes(String(privateKey)), "the private key reached the screen");
    assert.ok(printed.includes(out), "the file it wrote was not named");
    assertModeWhereEnforced(out, 0o600, "the key file is readable by someone other than its owner");
    // Windows: the file is cut off from its folder, and the command says which way it went.
    assert.equal(printed.includes("only your Windows account can open this file"), !modesAreEnforced());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a file that is already there is never replaced", () => {
  const dir = sandbox();
  try {
    const out = join(dir, "keys.json");
    writeFileSync(out, "the only copy of another key\n");
    assert.throws(() => platform("keygen", { out, write: () => {} }), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 4);
      return true;
    });
    assert.equal(readFileSync(out, "utf8"), "the only copy of another key\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the key pair is never handed to stdout", () => {
  assert.throws(() => platform("keygen", { out: "-", write: () => {} }), /stdout/);
});

test("register says where a business registers, and exits with the usage code", () => {
  const lines: string[] = [];
  assert.equal(platform("register", { write: (l) => lines.push(l) }), 2);
  const printed = lines.join("\n");
  assert.match(printed, /browser/);
  assert.match(printed, /Settings › Developer › Platform/);
  assert.match(printed, /nmts\.me/);
});

test("a missing or unknown subcommand is a command-line error, not a failure", () => {
  for (const sub of [undefined, "frobnicate"]) {
    assert.throws(() => platform(sub, { write: () => {} }), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.equal(error.exitCode, 2);
      return true;
    });
  }
});


test("on Windows the key file keeps no inherited permission", { skip: modesAreEnforced() }, () => {
  const dir = sandbox();
  try {
    const out = join(dir, "keys.json");
    assert.equal(platform("keygen", { out, write: () => undefined }), 0);
    const listed = spawnSync("icacls", [out], { encoding: "utf8" });
    assert.equal(listed.status, 0, "icacls could not list the file");
    // icacls marks an inherited entry with (I); none may be left.
    assert.ok(!listed.stdout.includes("(I)"), `inherited entries remain:\n${listed.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

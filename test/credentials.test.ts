// What this file is for: the credentials file is the only place this tool writes a secret, so
// every test here is chosen to go RED for one specific way that could go wrong — not to describe
// what the code does.

import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CODE_ENV_VAR,
  CredentialsTooOpenError,
  credentialsPath,
  modesAreEnforced,
  readCredentialsFile,
  resolveAccountCode,
  testConfigDir,
  writeCredentials,
} from "../src/credentials.ts";

/** A value that must never appear in any message. Distinctive so a substring search is decisive. */
const SECRET = "SECRETCODE7Q4M2XZ9";

function withSandbox(name: string, body: () => void): void {
  const dir = testConfigDir(name);
  const previousDir = process.env["NMTS_CONFIG_DIR"];
  const previousCode = process.env[CODE_ENV_VAR];
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  delete process.env[CODE_ENV_VAR];
  try {
    body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env["NMTS_CONFIG_DIR"];
    else process.env["NMTS_CONFIG_DIR"] = previousDir;
    if (previousCode === undefined) delete process.env[CODE_ENV_VAR];
    else process.env[CODE_ENV_VAR] = previousCode;
  }
}

test("the file it writes cannot be read by other users", () => {
  withSandbox("mode", () => {
    writeCredentials({ accountCode: SECRET, server: "https://nmts.me" });
    if (!modesAreEnforced()) return; // Windows gives no mode to check; saying otherwise would lie.
    const mode = statSync(credentialsPath()).mode & 0o777;
    assert.equal(mode & 0o077, 0, `credentials are group/world accessible: ${mode.toString(8)}`);
  });
});

test("writing twice replaces the file instead of failing on the existing name", () => {
  withSandbox("replace", () => {
    writeCredentials({ accountCode: "first", server: "https://nmts.me" });
    writeCredentials({ accountCode: "second", server: "https://nmts.me" });
    assert.equal(readCredentialsFile()?.accountCode, "second");
  });
});

test("a credentials file other users can read is REFUSED, not used", () => {
  withSandbox("too-open", () => {
    writeCredentials({ accountCode: SECRET, server: "https://nmts.me" });
    if (!modesAreEnforced()) return;
    chmodSync(credentialsPath(), 0o644);
    assert.throws(() => readCredentialsFile(), CredentialsTooOpenError);
  });
});

test("the refusal names the file and never the code", () => {
  withSandbox("no-leak-open", () => {
    writeCredentials({ accountCode: SECRET, server: "https://nmts.me" });
    if (!modesAreEnforced()) return;
    chmodSync(credentialsPath(), 0o604);
    try {
      readCredentialsFile();
      assert.fail("a world-readable credentials file was accepted");
    } catch (error) {
      const text = String(error);
      assert.ok(text.includes("credentials.json"), "the error should name the file");
      assert.ok(!text.includes(SECRET), "the error message carried the account code");
    }
  });
});

test("a malformed credentials file fails with a message that does not carry the code", () => {
  withSandbox("no-leak-malformed", () => {
    const dir = process.env["NMTS_CONFIG_DIR"] as string;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Shaped like the real file but missing `server`, with the secret present in the bytes.
    writeFileSync(join(dir, "credentials.json"), JSON.stringify({ accountCode: SECRET }), {
      mode: 0o600,
    });
    try {
      readCredentialsFile();
      assert.fail("a credentials file with no server was accepted");
    } catch (error) {
      assert.ok(!String(error).includes(SECRET), "the error message carried the account code");
    }
  });
});

test("no credentials file is not an error — it is 'not logged in'", () => {
  withSandbox("absent", () => {
    assert.equal(readCredentialsFile(), null);
    assert.equal(resolveAccountCode(), null);
  });
});

test("the environment variable wins over the file, so a code need never be written down", () => {
  withSandbox("env-wins", () => {
    writeCredentials({ accountCode: "from-file", server: "https://nmts.me" });
    process.env[CODE_ENV_VAR] = "from-env";
    const resolved = resolveAccountCode();
    assert.equal(resolved?.code, "from-env");
    assert.equal(resolved?.source, "env");
  });
});

test("an empty environment variable is not a code", () => {
  withSandbox("env-empty", () => {
    writeCredentials({ accountCode: "from-file", server: "https://nmts.me" });
    process.env[CODE_ENV_VAR] = "";
    assert.equal(resolveAccountCode()?.source, "file");
  });
});

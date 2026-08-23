// End-to-end: the real binary, the real exit codes.
//
// ⛔ THESE RUN THE PROGRAM, NOT A FUNCTION. Exit codes are how an agent decides whether to retry,
//    ask, or stop, and a test that calls `run()` directly cannot see the code the process actually
//    leaves behind — which is the thing that matters.

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { testConfigDir } from "../src/credentials.ts";
import { generateCode } from "./helpers.ts";

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

async function nmts(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(process.execPath, [MAIN, ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function sandbox(name: string): { dir: string; env: Record<string, string>; clean: () => void } {
  const dir = testConfigDir(name);
  rmSync(dir, { recursive: true, force: true });
  return { dir, env: { NMTS_CONFIG_DIR: dir }, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test("--version prints only the version and exits 0", async () => {
  const r = await nmts(["--version"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("no arguments prints help and exits 0 — an agent probing the tool learns what it does", async () => {
  const r = await nmts([]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /USAGE/);
  assert.match(r.stdout, /COMMANDS/);
});

test("help names every unbuilt command, so nothing is discovered by guessing", async () => {
  const r = await nmts(["--help"]);
  for (const command of ["ls", "put", "get"]) {
    assert.match(r.stdout, new RegExp(`\\b${command}\\b.*not built yet`), `${command} unmarked`);
  }
});

test("an announced-but-unbuilt command exits 4 and says not to retry", async () => {
  const r = await nmts(["ls"]);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /not built yet/);
  assert.match(r.stderr, /Do not retry/);
});

test("an unknown command exits 2 — a different code, because it means try a different name", async () => {
  const r = await nmts(["frobnicate"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown command/);
});

test("a mistyped option stops the run rather than silently using the default server", async () => {
  const r = await nmts(["ls", "--serverr", "https://example.invalid"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Unknown option/);
});

test("login with no terminal and no environment variable exits 3 and says what to set", async () => {
  const s = sandbox("cli-no-tty");
  try {
    const r = await nmts(["login"], s.env);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /NMTS_ACCOUNT_CODE/);
  } finally {
    s.clean();
  }
});

test("login stores the code from the environment, 0600, and separates the two checks", async () => {
  const s = sandbox("cli-login");
  const code = await generateCode();
  try {
    const r = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(r.code, 0);
    const path = join(s.dir, "credentials.json");
    assert.ok(existsSync(path), "no credentials file was written");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).accountCode, code);
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o077, 0, "credentials are readable by others");
    }
    // ⛔ The two claims are separate and the tool must keep them separate: the code's SHAPE was
    //    verified here, and whether the ACCOUNT exists was not.
    assert.match(r.stdout, /well-formed/);
    assert.match(r.stdout, /Whether the account EXISTS has not been checked/);
  } finally {
    s.clean();
  }
});

test("the first run shows the notice about what an account code is; the second does not", async () => {
  const s = sandbox("cli-notice");
  const code = await generateCode();
  try {
    const first = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.match(first.stdout, /only key to your account/);
    const second = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.ok(!/only key to your account/.test(second.stdout), "the notice repeated on the second run");
  } finally {
    s.clean();
  }
});

test("no output anywhere echoes the account code back", async () => {
  const s = sandbox("cli-no-echo");
  const code = await generateCode();
  try {
    const r = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.ok(!r.stdout.includes(code), "stdout carried the account code");
    assert.ok(!r.stderr.includes(code), "stderr carried the account code");
  } finally {
    s.clean();
  }
});

test("logout removes the file and does not claim to have ended anything on the server", async () => {
  const s = sandbox("cli-logout");
  const code = await generateCode();
  try {
    await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    const r = await nmts(["logout"], s.env);
    assert.equal(r.code, 0);
    assert.ok(!existsSync(join(s.dir, "credentials.json")), "the credentials file survived logout");
    assert.match(r.stdout, /did not end anything on the server/);
  } finally {
    s.clean();
  }
});

test("logout with nothing stored says so instead of failing", async () => {
  const s = sandbox("cli-logout-empty");
  try {
    const r = await nmts(["logout"], s.env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Nothing to remove/);
  } finally {
    s.clean();
  }
});

test("whoami refuses to guess: no code on this machine exits 3, not 0 with blanks", async () => {
  const s = sandbox("cli-whoami-none");
  try {
    const r = await nmts(["whoami"], s.env);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /NMTS_ACCOUNT_CODE/);
  } finally {
    s.clean();
  }
});

test("whoami answers offline and says so, so an account id does not read as 'connected'", async () => {
  const s = sandbox("cli-whoami");
  const code = await generateCode();
  try {
    const r = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Account id\s+[A-Za-z0-9_-]{22}/);
    assert.match(r.stdout, /Public code\s+[0-9A-Z]{9}-/);
    assert.match(r.stdout, /Nothing was asked of the server/);
    assert.ok(!r.stdout.includes(code), "whoami printed the account code");
  } finally {
    s.clean();
  }
});

test("whoami says WHERE the code came from — stored, or only in the environment", async () => {
  const s = sandbox("cli-whoami-source");
  const code = await generateCode();
  try {
    const fromEnv = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.match(fromEnv.stdout, /not stored/);
    await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    const fromFile = await nmts(["whoami"], s.env);
    assert.match(fromFile.stdout, /this machine/);
  } finally {
    s.clean();
  }
});

test("⛔ login refuses a mistyped code offline instead of storing it", async () => {
  const s = sandbox("cli-login-typo");
  const code = await generateCode();
  const flipped = (code[0] === "0" ? "1" : "0") + code.slice(1);
  try {
    const r = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: flipped });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a valid NMTS account code/);
    assert.ok(!existsSync(join(s.dir, "credentials.json")), "a bad code was written to disk");
  } finally {
    s.clean();
  }
});

// End-to-end: the real binary, the real exit codes.
//
// ⛔ THESE RUN THE PROGRAM, NOT A FUNCTION. Exit codes are how an agent decides whether to retry,
//    ask, or stop, and a test that calls `run()` directly cannot see the code the process actually
//    leaves behind — which is the thing that matters.

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { NOT_BUILT_YET } from "../src/main.ts";
import { testConfigDir } from "../src/credentials.ts";
import { generateCode, grantConsents } from "./helpers.ts";

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

/**
 * A config directory of this test's own, optionally with agreements already in it.
 *
 * ⛔ THE AGREEMENTS ARE NEVER SEEDED BY DEFAULT. Handing the code in through the environment asks
 *    for `plain-env` once, and storing it unsealed asks for `unsafe-code-storage`; a sandbox that
 *    granted both to every test would make the two tests below — the ones that prove the refusal
 *    happens — the only place the difference could be seen, and a wrong default would look green.
 */
/** ⚠ Not a secret: it locks a throwaway code the engine made for this run and nothing else. */
const PASS = "correct horse battery staple";

function sandbox(
  name: string,
  ...consents: readonly string[]
): { dir: string; env: Record<string, string>; clean: () => void } {
  const dir = testConfigDir(name);
  rmSync(dir, { recursive: true, force: true });
  if (consents.length > 0) grantConsents(dir, ...consents);
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

test("⛔ every command help names is one this version can actually run", async () => {
  // The list this reads used to hold `put`, and these two tests said so out loud so an agent could
  // not discover an unfinished command by guessing at it. `put` shipped, the list emptied, and the
  // tests failed rather than quietly asserting nothing -- which is what they were written to do.
  // What is left is the half that does not expire: nothing in help wears the unfinished mark.
  const r = await nmts(["--help"]);
  assert.equal(NOT_BUILT_YET.length, 0, "something is unfinished -- announce it in help and say so here");
  assert.doesNotMatch(
    r.stdout,
    /not built yet/,
    "help marks a command as unfinished while the tool believes everything is built",
  );
  for (const command of ["login", "logout", "whoami", "ls", "put", "get", "mcp", "verify"]) {
    assert.match(r.stdout, new RegExp(`\\b${command}\\b`), `${command} is missing from help`);
  }
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

test("the first run shows the notice about what an account code is; the second does not", async () => {
  const s = sandbox("cli-notice", "plain-env");
  const code = await generateCode();
  try {
    const first = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    assert.match(first.stdout, /only key to your account/);
    const second = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    assert.ok(!/only key to your account/.test(second.stdout), "the notice repeated on the second run");
  } finally {
    s.clean();
  }
});

test("no output anywhere echoes the account code back", async () => {
  const s = sandbox("cli-no-echo", "plain-env");
  const code = await generateCode();
  try {
    const r = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    assert.ok(!r.stdout.includes(code), "stdout carried the account code");
    assert.ok(!r.stderr.includes(code), "stderr carried the account code");
  } finally {
    s.clean();
  }
});

test("logout removes the file and does not claim to have ended anything on the server", async () => {
  const s = sandbox("cli-logout", "plain-env");
  const code = await generateCode();
  try {
    await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
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
  const s = sandbox("cli-whoami", "plain-env");
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
  const s = sandbox("cli-whoami-source", "plain-env");
  const code = await generateCode();
  try {
    const fromEnv = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.match(fromEnv.stdout, /not stored/);
    await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    const fromFile = await nmts(["whoami"], { ...s.env, NMTS_PASSPHRASE: PASS });
    assert.match(fromFile.stdout, /this machine/);
  } finally {
    s.clean();
  }
});

test("verify is wired to the switch: it refuses for want of a key, not as an unknown command", async () => {
  // ⛔ THE TWO CODES ARE THE POINT. 2 would mean the command name never reached a case and an
  //    agent should try another spelling; 3 means the command ran and wants a credential.
  const s = sandbox("cli-verify-nokey");
  try {
    const r = await nmts(["verify", "--status"], { ...s.env, NMTS_API_KEY: "" });
    assert.equal(r.code, 3);
    assert.match(r.stderr, /NMTS_API_KEY/);
  } finally {
    s.clean();
  }
});

test("⛔ login refuses a mistyped code offline instead of storing it", async () => {
  const s = sandbox("cli-login-typo", "plain-env");
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

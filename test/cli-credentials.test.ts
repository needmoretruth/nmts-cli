// Keeping the account code on this machine — the four ways in, and the two agreements.
//
// ⛔ SPLIT OUT OF `cli.test.ts` WHEN THAT FILE PASSED ITS LENGTH CEILING. These run the real
//    binary as a child process for the same reason the other file does: what is being tested is
//    what a person or an agent sees, including the exit code, and an in-process call would test
//    the functions rather than the tool.
//
// ⛔ NO SANDBOX HERE SEEDS AN AGREEMENT IT IS NOT TESTING. Six of these used to seed `plain-env`
//    without thinking about it, which is exactly why none of them saw that `login` was a way into
//    the environment variable that never asked.
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
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


test("⛔ login seals by default — what lands on disk is not the account code", async () => {
  const s = sandbox("cli-login", "plain-env");
  const code = await generateCode();
  try {
    const r = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    assert.equal(r.code, 0, r.stderr);
    const path = join(s.dir, "credentials.json");
    assert.ok(existsSync(path), "no credentials file was written");
    const raw = readFileSync(path, "utf8");
    // ⛔ THE DISCRIMINATING ASSERTION. "There is a lockedCode field" would pass on a file that
    //    also carried the code in the clear beside it, which is exactly the mistake worth
    //    catching. This one looks at every byte of the file.
    assert.ok(!raw.includes(code), "the sealed file carried the account code anyway");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.accountCode, undefined, "a plain copy was written next to the sealed one");
    assert.equal(parsed.lockedCode.kdf, "scrypt");
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

test("a sealed code is opened by the passphrase, and a wrong one opens nothing", async () => {
  const s = sandbox("cli-sealed-open", "plain-env");
  const code = await generateCode();
  try {
    await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    // ⚠ The stored copy is the only one in play from here: the environment variable is gone.
    const right = await nmts(["whoami"], { ...s.env, NMTS_PASSPHRASE: PASS });
    assert.equal(right.code, 0, right.stderr);
    assert.match(right.stdout, /Account id\s+[A-Za-z0-9_-]{22}/);

    const wrong = await nmts(["whoami"], { ...s.env, NMTS_PASSPHRASE: "not the passphrase" });
    assert.notEqual(wrong.code, 0, "a wrong passphrase answered anyway");
    assert.match(wrong.stderr, /passphrase/i);
    assert.ok(!wrong.stdout.includes(code), "a wrong passphrase printed something from the code");

    // ⛔ And with NO passphrase at all it says which of the ways out to take, rather than hanging
    //    or reporting "not signed in" — which would send somebody looking for the wrong thing.
    const none = await nmts(["whoami"], s.env);
    assert.equal(none.code, 3);
    assert.match(none.stderr, /NMTS_PASSPHRASE/);
  } finally {
    s.clean();
  }
});

test("⛔ storing the code unsealed stops for an agreement, and writes nothing until it has one", async () => {
  const s = sandbox("cli-plain-refused", "plain-env");
  const code = await generateCode();
  try {
    const refused = await nmts(["login", "--plain"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(refused.code, 5, refused.stderr);
    assert.match(refused.stderr, /unsafe-code-storage/);
    assert.ok(
      !existsSync(join(s.dir, "credentials.json")),
      "a refused login wrote the credentials file anyway",
    );

    grantConsents(s.dir, "plain-env", "unsafe-code-storage");
    const allowed = await nmts(["login", "--plain"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(JSON.parse(readFileSync(join(s.dir, "credentials.json"), "utf8")).accountCode, code);
  } finally {
    s.clean();
  }
});

test("⛔ `login` ITSELF stops for the plain-environment agreement — it is a way in too", async () => {
  // ⛔ THE HOLE AN ADVERSARIAL REVIEW FOUND. `login` read NMTS_ACCOUNT_CODE for itself instead of
  //    going through the one door, so two commands laundered a code out of the environment into a
  //    sealed store — which needs no agreement — with nothing ever recorded. Every other sealed
  //    login test seeds `plain-env` into its sandbox, which is exactly why none of them saw it.
  const s = sandbox("cli-login-env-gate");
  const code = await generateCode();
  try {
    const refused = await nmts(["login"], { ...s.env, NMTS_ACCOUNT_CODE: code, NMTS_PASSPHRASE: PASS });
    assert.equal(refused.code, 5, refused.stderr);
    assert.match(refused.stderr, /plain-env/);
    assert.ok(!existsSync(join(s.dir, "credentials.json")), "it stored the code anyway");

    // And `--plain` is the same door.
    grantConsents(s.dir, "unsafe-code-storage");
    const stillRefused = await nmts(["login", "--plain"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(stillRefused.code, 5, stillRefused.stderr);
    assert.match(stillRefused.stderr, /plain-env/);
  } finally {
    s.clean();
  }
});

test("⛔ a file named by NMTS_ACCOUNT_CODE_FILE is a way in for `login`, and asks nothing", async () => {
  const s = sandbox("cli-login-from-file");
  const code = await generateCode();
  try {
    mkdirSync(s.dir, { recursive: true });
    const codeFile = join(s.dir, "code");
    writeFileSync(codeFile, code, { mode: 0o600 });
    const r = await nmts(["login"], {
      ...s.env,
      NMTS_ACCOUNT_CODE_FILE: codeFile,
      NMTS_PASSPHRASE: PASS,
    });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(s.dir, "consent.json")), "it recorded an agreement nobody gave");
  } finally {
    s.clean();
  }
});

test("⛔ a sealed login remembers the server and network it was made for", async () => {
  // ⛔ It read `source === "file"` only, so the day sealing became the default, `whoami` began
  //    telling people on a development stack that they were on the live server and mainnet.
  const s = sandbox("cli-sealed-where", "plain-env");
  const code = await generateCode();
  try {
    const stored = await nmts(["login", "--server", "http://127.0.0.1:9", "--network", "testnet"], {
      ...s.env,
      NMTS_ACCOUNT_CODE: code,
      NMTS_PASSPHRASE: PASS,
    });
    assert.equal(stored.code, 0, stored.stderr);
    const r = await nmts(["whoami"], { ...s.env, NMTS_PASSPHRASE: PASS });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /http:\/\/127\.0\.0\.1:9/);
    assert.match(r.stdout, /testnet/);
  } finally {
    s.clean();
  }
});

test("⛔ the code from a plain environment variable stops for an agreement first", async () => {
  const s = sandbox("cli-plain-env-refused");
  const code = await generateCode();
  try {
    const refused = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(refused.code, 5, refused.stderr);
    assert.match(refused.stderr, /plain-env/);
    // ⛔ Discriminating: it must be refused for the right reason, not because nothing was found.
    assert.ok(!/No NMTS account code/.test(refused.stderr), "it read as 'not signed in' instead");

    grantConsents(s.dir, "plain-env");
    const allowed = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(allowed.code, 0, allowed.stderr);
  } finally {
    s.clean();
  }
});

test("⛔ a file named by NMTS_ACCOUNT_CODE_FILE asks for nothing — it is the recommended way", async () => {
  const s = sandbox("cli-secret-file");
  const code = await generateCode();
  try {
    const codeFile = join(s.dir, "code");
    mkdirSync(s.dir, { recursive: true });
    writeFileSync(codeFile, code, { mode: 0o600 });
    const r = await nmts(["whoami"], { ...s.env, NMTS_ACCOUNT_CODE_FILE: codeFile });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(s.dir, "consent.json")), "it recorded an agreement nobody gave");
  } finally {
    s.clean();
  }
});

test("login --env writes nothing and prints the line to set, behind the same agreement", async () => {
  const s = sandbox("cli-login-env");
  const code = await generateCode();
  try {
    const refused = await nmts(["login", "--env"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(refused.code, 5, refused.stderr);
    // ⛔ DISCRIMINATING: moving the agreement one line later would still exit 5 — after printing
    //    the code. What is being tested is that nothing came out, not that something was refused.
    assert.ok(!refused.stdout.includes(code), "a refused --env printed the account code anyway");
    assert.ok(!refused.stderr.includes(code), "a refused --env put the account code on stderr");

    grantConsents(s.dir, "plain-env");
    const r = await nmts(["login", "--env"], { ...s.env, NMTS_ACCOUNT_CODE: code });
    assert.equal(r.code, 0, r.stderr);
    // ⛔ THIS is the one command allowed to print the code, and it must actually print it —
    //    otherwise the line it hands over is a line that does not work.
    assert.ok(
      r.stdout.includes(`export ${CODE_ENV_VAR}='${code}'`),
      "--env did not print a line that would actually set the variable",
    );
    assert.ok(
      !existsSync(join(s.dir, "credentials.json")),
      "--env wrote the credentials file it says it does not write",
    );
  } finally {
    s.clean();
  }
});

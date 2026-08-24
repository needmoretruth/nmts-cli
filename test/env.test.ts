// What `nmts env` measures, and the pipe behaviour every command depends on.

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

import { adviseFor, detectContainment, readEnvironment } from "../src/environment.ts";
import { env } from "../src/commands/env.ts";
import { generateCode } from "./helpers.ts";

const run = promisify(execFile);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-env-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

test("containment is one of the values this version knows, never invented", () => {
  assert.ok(["docker", "podman", "container", "none", "unknown"].includes(detectContainment()));
});

test("⛔ nothing about a credential's VALUE is reported", () => {
  const dir = isolate();
  try {
    const secret = "SOME-ACCOUNT-CODE-SHAPED-STRING-XYZ";
    process.env["NMTS_ACCOUNT_CODE"] = secret;
    const lines: string[] = [];
    env({ json: true, write: (l) => lines.push(l) });
    const text = lines.join("");
    assert.doesNotMatch(text, new RegExp(secret), "the code itself was printed");
    const parsed: unknown = JSON.parse(text);
    const code = Reflect.get(parsed as object, "accountCode");
    assert.deepEqual(code, { present: true, source: "env" }, "presence and source, never the value");
  } finally {
    delete process.env["NMTS_ACCOUNT_CODE"];
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a credential that was REFUSED is reported as refused, not as absent", () => {
  const dir = isolate();
  try {
    process.env["NMTS_ACCOUNT_CODE_FILE"] = join(dir, "nothing-here");
    const lines: string[] = [];
    assert.equal(env({ json: true, write: (l) => lines.push(l) }), 0, "it crashed instead of answering");
    const parsed = JSON.parse(lines.join("")) as { accountCode: { present?: boolean; refused?: string } | null };
    // ⛔ "not found" would be a lie with consequences. The same branch carries the case that
    //    matters most — a credentials file gone world-readable — and this is the one command
    //    written to be run first on a machine nobody knows.
    assert.notEqual(parsed.accountCode, null, "a refusal was reported as 'no code here'");
    assert.equal(parsed.accountCode?.present, false);
    assert.match(String(parsed.accountCode?.refused), /NMTS_ACCOUNT_CODE_FILE/);
  } finally {
    delete process.env["NMTS_ACCOUNT_CODE_FILE"];
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a refusal names the path and never the value", async () => {
  const dir = isolate();
  const secret = await generateCode();
  try {
    const path = join(dir, "credentials.json");
    mkdirSync(dir, { recursive: true });
    // A file the tool cannot use, with a real code inside it: one lost quote.
    writeFileSync(path, `{"accountCode":${secret}","server":"https://nmts.me"}`, { mode: 0o600 });
    const lines: string[] = [];
    assert.equal(env({ json: true, write: (l) => lines.push(l) }), 0);
    const whole = lines.join("");
    assert.match(whole, /credentials\.json/, "it did not say which file");
    // ⛔ THE DISCRIMINATING PART. The parser's own message quotes about thirty characters of the
    //    input, and the input is the file the account code is in.
    for (const run of secret.replace(/\s+/gu, "").match(/.{6}/gu) ?? []) {
      assert.ok(!whole.includes(run), `six characters of the account code reached the output`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("advice names the filesystem when a file mode cannot be kept", () => {
  const base = readEnvironment();
  const said = adviseFor({ ...base, privateStorage: false }, true);
  assert.ok(said.some((a) => a.level === "warn" && /does not keep the mode/.test(a.text)));
});

test("⛔ rootless is about the MAPPING, not about the uid inside", () => {
  // A rootless container is uid 0 inside and an ordinary user outside. Reading the uid answers
  // the wrong question, and answers it backwards.
  const base = readEnvironment();
  const rootless = adviseFor({ ...base, containment: "podman", rootMapped: true, uid: 0 }, true);
  assert.ok(
    rootless.some((a) => /rootless: root inside it is an ordinary user/.test(a.text)),
    "uid 0 inside a mapped namespace was reported as running as root",
  );
  assert.ok(!rootless.some((a) => /running as root/.test(a.text)));

  const rootful = adviseFor({ ...base, containment: "docker", rootMapped: false, uid: 0 }, true);
  assert.ok(rootful.some((a) => a.level === "warn" && /root on the host/.test(a.text)));
});

test("a container is told its config directory does not survive removal", () => {
  const base = readEnvironment();
  const said = adviseFor({ ...base, containment: "docker", rootMapped: true }, true);
  assert.ok(said.some((a) => /lost when it is removed/.test(a.text)));
  assert.ok(
    said.some((a) => a.level === "warn" && /NMTS_ACCOUNT_CODE_FILE/.test(a.text)),
    "a container must be told not to put the code in an environment variable",
  );
});

test("⛔ a closed pipe ends the run quietly — `nmts ls | head` is an ordinary thing to do", async () => {
  // Without this, Node turns EPIPE into a fatal error and the caller reads a stack trace where
  // the answer should be. An agent piping this anywhere would conclude the tool is broken.
  //
  // ⛔ `env`, NOT `--help`. The help text is written in ONE call and fits inside the pipe buffer,
  //    so it never reaches a closed pipe and a test using it passes with the handler removed —
  //    measured. `env` writes a line at a time, which is what actually meets the closed pipe.
  const { stdout, stderr } = await run("/bin/sh", ["-c", `node ${MAIN} env | head -2`]);
  assert.match(stdout, /system/);
  assert.doesNotMatch(stderr, /EPIPE/);
  assert.doesNotMatch(stderr, /Unhandled/);
});

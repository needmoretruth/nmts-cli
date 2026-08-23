import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FLAGS, OPTIONS_TAKING_A_VALUE, parseArgs } from "../src/args.ts";
import { NmtsError } from "../src/errors.ts";

test("⛔ no option is a place to put a secret", () => {
  // The rule this guards: a secret passed on the command line is readable by any process on the
  // machine and is recorded by the shell. If a future option name looks like a credential, this
  // fails and the reviewer has to justify it rather than notice it.
  const suspicious = /code|key|secret|token|password|pass|credential/i;
  for (const name of [...OPTIONS_TAKING_A_VALUE, ...FLAGS]) {
    assert.ok(!suspicious.test(name), `option ${name} looks like it carries a secret`);
  }
});

test("a command with operands", () => {
  const a = parseArgs(["put", "a.txt", "b.txt"]);
  assert.equal(a.command, "put");
  assert.deepEqual(a.operands, ["a.txt", "b.txt"]);
});

test("--server takes the next token, and the = form works too", () => {
  assert.equal(parseArgs(["ls", "--server", "http://localhost:3300"]).server, "http://localhost:3300");
  assert.equal(parseArgs(["ls", "--server=http://localhost:3300"]).server, "http://localhost:3300");
});

test("--server with nothing after it is an error, not an empty string", () => {
  assert.throws(() => parseArgs(["ls", "--server"]), NmtsError);
});

test("--server followed by another option is an error, not a server named --help", () => {
  assert.throws(() => parseArgs(["ls", "--server", "--help"]), NmtsError);
});

test("an unknown option stops the run instead of being ignored", () => {
  // Ignoring it means `--serverr https://x` silently talks to the live server.
  assert.throws(() => parseArgs(["ls", "--serverr", "https://x"]), NmtsError);
});

test("no command is not an error — it is the help case", () => {
  const a = parseArgs([]);
  assert.equal(a.command, null);
  assert.equal(a.help, false);
});

test("flags are recognised before and after the command", () => {
  assert.equal(parseArgs(["--help", "ls"]).help, true);
  assert.equal(parseArgs(["ls", "--help"]).help, true);
  assert.equal(parseArgs(["-V"]).version, true);
});

// `nmts update` — the command itself.
//
// ⛔ EVERY TEST HERE IS OFFLINE: the lookup and the installer are both injected. What the lookup
//    does on a real wire, and the once-a-day notice around it, are in `update-check.test.ts`;
//    what is here is the decision the command makes with an answer it already has.
//    (The two files are separate because one file grew past the length gate; the seam is
//    "the wire and the record" against "the decision".)

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { update, installedAsPackage, type InstallOutcome } from "../src/commands/update.ts";
import { installCommand } from "../src/update-source.ts";
test("`update` says so and installs nothing when this is the newest", async () => {
  const said: string[] = [];
  let installed = 0;
  const code = await update({
    running: "9.9.9",
    lookup: async () => ({ version: "9.9.9" }),
    write: (l) => said.push(l),
    install: () => {
      installed += 1;
      return { code: 0 };
    },
  });
  assert.equal(code, 0);
  assert.equal(installed, 0);
  assert.match(said.join("\n"), /newest published release/);
});

test("⛔ `update` refuses to install a second copy beside one it did not put there", async () => {
  const said: string[] = [];
  let installed = 0;
  const code = await update({
    running: "0.2.0",
    lookup: async () => ({ version: "9.9.9" }),
    // A source checkout. Installing would put a second copy on the PATH, and which one runs
    // afterwards depends on the order of directories in an environment variable.
    moduleFile: "/opt/checkout/nmts-cli/src/commands/update.ts",
    write: (l) => said.push(l),
    install: () => {
      installed += 1;
      return { code: 0 };
    },
  });
  assert.equal(installed, 0, "it installed anyway");
  assert.equal(code, 4);
  assert.match(said.join("\n"), /would leave two/);
});

test("installed copies are recognised by where the installer puts them", () => {
  assert.equal(installedAsPackage("/usr/lib/node_modules/nmts/dist/commands/update.js"), true);
  assert.equal(installedAsPackage("/opt/npm-global/lib/node_modules/nmts/dist/commands/update.js"), true);
  assert.equal(installedAsPackage("/opt/checkout/nmts-cli/src/commands/update.ts"), false);
  assert.equal(installedAsPackage("/opt/other/node_modules/something-else/dist/main.js"), false);
});

// ⛔ THE ONE THAT WENT RED ONLY ON WINDOWS, AND ONLY AFTER IT WAS PUBLISHED. Splitting a path on
//    the platform's own separator found nothing in `D:/a/…`, which is a shape Node really hands
//    out — so an installed copy was told it was not installed, and `update` refused to run. Both
//    spellings are asserted here on every platform, because a rule tested only where it happens
//    to hold is a rule nobody is testing.
test("⛔ both path separators, whichever platform this runs on", () => {
  assert.equal(installedAsPackage("D:\\npm\\node_modules\\nmts\\dist\\commands\\update.js"), true);
  assert.equal(installedAsPackage("D:/npm/node_modules/nmts/dist/commands/update.js"), true);
  assert.equal(installedAsPackage("D:\\a\\nmts-cli\\src\\commands\\update.ts"), false);
  assert.equal(installedAsPackage("D:/a/nmts-cli/src/commands/update.ts"), false);
  // Mixed, which is what a path that passed through both a URL and `join` looks like.
  assert.equal(installedAsPackage("D:/npm\\node_modules/nmts\\dist/commands/update.js"), true);
});

test("`update` runs exactly the command it printed", async () => {
  const said: string[] = [];
  let ran: readonly string[] = [];
  const code = await update({
    running: "0.2.0",
    lookup: async () => ({ version: "9.9.9" }),
    moduleFile: "/usr/lib/node_modules/nmts/dist/commands/update.js",
    write: (l) => said.push(l),
    install: (command): InstallOutcome => {
      ran = command;
      return { code: 0 };
    },
  });
  assert.equal(code, 0);
  const printed = said.join("\n");
  assert.deepEqual(ran, installCommand("9.9.9"));
  assert.ok(printed.includes(ran.join(" ")), "what it ran was not what it showed");
});

test("⛔ an installer that fails leaves a failure, not a cheerful zero", async () => {
  await assert.rejects(
    update({
      running: "0.2.0",
      lookup: async () => ({ version: "9.9.9" }),
      moduleFile: "/usr/lib/node_modules/nmts/dist/commands/update.js",
      write: () => undefined,
      install: () => ({ code: 243 }),
    }),
    (error: unknown) => {
      assert.match(String(error), /243/);
      return true;
    },
  );
});

test("--dry-run reports and ends at 0 whichever copy this is", async () => {
  for (const moduleFile of [
    "/usr/lib/node_modules/nmts/dist/commands/update.js",
    "/opt/checkout/nmts-cli/src/commands/update.ts",
  ]) {
    const said: string[] = [];
    let installed = 0;
    const code = await update({
      running: "0.2.0",
      dryRun: true,
      lookup: async () => ({ version: "9.9.9" }),
      moduleFile,
      write: (l) => said.push(l),
      install: () => {
        installed += 1;
        return { code: 0 };
      },
    });
    assert.equal(installed, 0, `${moduleFile}: a dry run installed something`);
    assert.equal(code, 0, `${moduleFile}: a dry run reported a failure that did not happen`);
    assert.match(said.join("\n"), /npm install --global/);
  }
});

test("--json answers in one line and never in prose", async () => {
  const said: string[] = [];
  const code = await update({
    running: "0.2.0",
    lookup: async () => ({ version: "9.9.9" }),
    moduleFile: "/usr/lib/node_modules/nmts/dist/commands/update.js",
    json: true,
    write: (l) => said.push(l),
    install: () => ({ code: 0 }),
  });
  assert.equal(code, 0);
  assert.equal(said.length, 1);
  const parsed = JSON.parse(said[0] ?? "") as Record<string, unknown>;
  assert.equal(parsed["running"], "0.2.0");
  assert.equal(parsed["latest"], "9.9.9");
  assert.equal(parsed["installed"], true);
});

test("a lookup that could not answer is a loud failure when the command asked for it", async () => {
  // The implicit check is quiet on purpose; the command somebody typed is not.
  await assert.rejects(
    update({ running: "0.2.0", lookup: async () => ({ failed: "nothing answered" }), write: () => undefined }),
    /Could not find out which release is newest/,
  );
});

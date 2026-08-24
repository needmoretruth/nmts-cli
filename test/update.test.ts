// `nmts update`, and the once-a-day notice that a newer release exists.
//
// ⛔ EVERY TEST HERE IS OFFLINE. The one hop across the network is injected, and the two that
//    exercise the wire talk to a server this file starts. A test that asked the real releases page
//    would go red on a day somebody published something, which is the shape of gate people learn
//    to ignore.

import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { update, installedAsPackage, type InstallOutcome } from "../src/commands/update.ts";
import {
  CHECK_EVERY_MS,
  checkPath,
  dueForCheck,
  lookupLatest,
  noteUpdate,
  readCheck,
  writeCheck,
  NO_CHECK_ENV_VAR,
  type Lookup,
} from "../src/update-check.ts";
import {
  compareVersions,
  installCommand,
  installCommandLine,
  isNewer,
  isVersion,
  packageUrl,
  releasePageUrl,
  versionFromLocation,
} from "../src/update-source.ts";

import { VERSION } from "../src/product.ts";
import { assertModeWhereEnforced } from "./helpers.ts";

const REPO = "https://github.com/needmoretruth/nmts-cli";
const run = promisify(execFile);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-update-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  delete process.env[NO_CHECK_ENV_VAR];
  return dir;
}

test("the version is read out of the redirect the releases page answers with", () => {
  assert.equal(versionFromLocation(`${REPO}/releases/tag/v0.2.0`), "0.2.0");
  assert.equal(versionFromLocation(`${REPO}/releases/tag/v10.20.30`), "10.20.30");
  // Relative, which is what a redirect is allowed to be.
  assert.equal(versionFromLocation("/needmoretruth/nmts-cli/releases/tag/v1.0.0"), "1.0.0");
});

test("⛔ a redirect somewhere else is not an answer to the question that was asked", () => {
  // The address arrives off the network. Reading a version out of any of these would let whoever
  // answered decide what this tool calls the newest release — and, one step later, what it installs.
  assert.equal(versionFromLocation("https://example.invalid/releases/tag/v9.9.9"), null);
  assert.equal(versionFromLocation(`http://github.com/needmoretruth/nmts-cli/releases/tag/v9.9.9`), null);
  assert.equal(versionFromLocation(`${REPO}/releases/tag/v9.9.9-rc1`), null);
  assert.equal(versionFromLocation(`${REPO}/releases/tag/nightly`), null);
  assert.equal(versionFromLocation(`${REPO}/issues/1`), null);
  assert.equal(versionFromLocation("not a url at all"), null);
});

test("versions compare by number, not by text", () => {
  // The one that a string comparison gets wrong, and the reason this is not `<`.
  assert.equal(isNewer("0.10.0", "0.9.0"), true);
  assert.equal(isNewer("0.9.0", "0.10.0"), false);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.2.0", "0.2.0"), false);
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
});

test("⛔ an unreadable version answers NO, never yes", () => {
  // The direction matters: the failure of a loose parse is a tool that nags about a release that
  // does not exist, or hands an unchecked string to a command line.
  assert.equal(compareVersions("nightly", "0.2.0"), null);
  assert.equal(isNewer("nightly", "0.2.0"), false);
  assert.equal(isNewer("0.2", "0.1.0"), false);
  assert.equal(isVersion("0.2.0-rc1"), false);
});

test("⛔ nothing but three numbers ever reaches a command line or a URL", () => {
  for (const bad of ["v0.2.0", "0.2", "1.0.0 ; rm -rf /", "../../etc", ""]) {
    assert.equal(packageUrl(bad), null, `${bad} produced an address`);
    assert.equal(installCommand(bad), null, `${bad} produced a command`);
    assert.equal(releasePageUrl(bad), null, `${bad} produced a page`);
  }
  assert.deepEqual(installCommand("0.3.0"), [
    "npm",
    "install",
    "--global",
    `${REPO}/releases/download/v0.3.0/nmts.tgz`,
  ]);
});

test("⛔ the install names a release, never `latest`", () => {
  // What was printed and what gets installed have to be the same thing. "latest" makes them two
  // separate questions, and a release published in between makes them different answers.
  const line = installCommandLine("0.3.0");
  assert.ok(line !== null);
  assert.match(line, /\/releases\/download\/v0\.3\.0\//);
  assert.doesNotMatch(line, /releases\/latest/);
});

/** A releases page that answers the way the real one does. */
async function startFakeReleases(): Promise<{ base: string; tag: string; status: number; close(): void }> {
  const state = { tag: "v9.9.9", status: 302 };
  const server: Server = createServer((request, response) => {
    if (request.url === "/releases/latest" && state.status >= 300 && state.status < 400) {
      response.writeHead(state.status, { location: `${REPO}/releases/tag/${state.tag}` });
      response.end();
      return;
    }
    response.writeHead(state.status);
    response.end("no");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return {
    base: `http://127.0.0.1:${address.port}`,
    get tag() {
      return state.tag;
    },
    set tag(value: string) {
      state.tag = value;
    },
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    close() {
      server.close();
    },
  };
}

test("the lookup reads the redirect and never follows it", async () => {
  const fake = await startFakeReleases();
  try {
    assert.deepEqual(await lookupLatest(`${fake.base}/releases/latest`), { version: "9.9.9" });
    fake.status = 404;
    const failed = await lookupLatest(`${fake.base}/releases/latest`);
    assert.ok("failed" in failed, "a 404 was read as an answer");
    fake.status = 302;
    fake.tag = "nightly";
    const unreadable = await lookupLatest(`${fake.base}/releases/latest`);
    assert.ok("failed" in unreadable, "a tag that is not a version was read as one");
  } finally {
    fake.close();
  }
});

test("a host that cannot be reached is a recorded failure, not a crash", async () => {
  // 127.0.0.1:1 has nothing listening. The point is the shape of the answer.
  const result = await lookupLatest("http://127.0.0.1:1/releases/latest");
  assert.ok("failed" in result);
});

test("the notice is one run behind: this run says what the last one found", async () => {
  const dir = isolate();
  try {
    const said: string[] = [];
    const lookup = async (): Promise<Lookup> => ({ version: "9.9.9" });
    await noteUpdate({ running: "0.2.0", say: (l) => said.push(l), lookup });
    assert.deepEqual(said, [], "the run that paid for the lookup also printed it");

    const later: string[] = [];
    await noteUpdate({
      running: "0.2.0",
      say: (l) => later.push(l),
      lookup,
      now: new Date(Date.now() + CHECK_EVERY_MS + 1),
    });
    assert.equal(later.length, 1);
    assert.match(later[0] ?? "", /9\.9\.9 is published; this is 0\.2\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a failed lookup still stamps the file, so an unreachable host is not asked every run", async () => {
  const dir = isolate();
  try {
    let asked = 0;
    const lookup = async (): Promise<Lookup> => {
      asked += 1;
      return { failed: "nothing answered" };
    };
    await noteUpdate({ running: "0.2.0", say: () => undefined, lookup });
    await noteUpdate({ running: "0.2.0", say: () => undefined, lookup });
    await noteUpdate({ running: "0.2.0", say: () => undefined, lookup });
    assert.equal(asked, 1, "an unreachable host was asked once per command");
    const record = readCheck();
    assert.equal(record?.failed, "nothing answered", "the reason was swallowed with nowhere to read it");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a failed lookup does not throw away the version already known", async () => {
  const dir = isolate();
  try {
    await noteUpdate({ running: "0.2.0", say: () => undefined, lookup: async () => ({ version: "9.9.9" }) });
    await noteUpdate({
      running: "0.2.0",
      say: () => undefined,
      lookup: async () => ({ failed: "nothing answered" }),
      now: new Date(Date.now() + CHECK_EVERY_MS + 1),
    });
    assert.equal(readCheck()?.latest, "9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(`⛔ ${NO_CHECK_ENV_VAR} stops both halves`, async () => {
  const dir = isolate();
  try {
    process.env[NO_CHECK_ENV_VAR] = "1";
    let asked = 0;
    const said: string[] = [];
    writeCheck({ checkedAt: "2000-01-01T00:00:00.000Z", latest: "9.9.9" });
    await noteUpdate({
      running: "0.2.0",
      say: (l) => said.push(l),
      lookup: async () => {
        asked += 1;
        return { version: "9.9.9" };
      },
    });
    assert.equal(asked, 0, "it asked anyway");
    assert.deepEqual(said, [], "it printed anyway");
  } finally {
    delete process.env[NO_CHECK_ENV_VAR];
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a version written into the file by hand is shape-checked on the way out", () => {
  const dir = isolate();
  try {
    // The file sits in a directory anything running as you can write, and what it holds ends up
    // in a printed line.
    writeFileSync(
      checkPath(),
      JSON.stringify({ checkedAt: new Date().toISOString(), latest: "9.9.9 && curl evil" }),
    );
    assert.equal(readCheck()?.latest, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file stamped in the future is a clock that moved, not a check from tomorrow", () => {
  const now = Date.parse("2026-08-24T00:00:00.000Z");
  assert.equal(dueForCheck(null, now), true);
  assert.equal(dueForCheck({ checkedAt: "2026-08-23T23:00:00.000Z" }, now), false);
  assert.equal(dueForCheck({ checkedAt: "2026-08-22T00:00:00.000Z" }, now), true);
  assert.equal(dueForCheck({ checkedAt: "2027-01-01T00:00:00.000Z" }, now), true);
  assert.equal(dueForCheck({ checkedAt: "not a date" }, now), true);
});

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

test("⛔ the file the check writes is not world-readable", () => {
  const dir = isolate();
  try {
    writeCheck({ checkedAt: new Date().toISOString(), latest: "9.9.9" });
    const held = JSON.parse(readFileSync(checkPath(), "utf8")) as { latest?: string };
    assert.equal(held.latest, "9.9.9");
    assertModeWhereEnforced(checkPath(), 0o600, "the version check file is readable by others");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ⛔ THE TWO BELOW ARE THE ONLY ONES THAT REACH `main`. Everything above drives `noteUpdate`
//    directly, and none of it would notice the notice being wired to stdout, wired to the wrong
//    place, or not wired at all. The cache is stamped NOW, so neither of them touches a network:
//    what they measure is where the line goes, and whether the switch reaches it.

/** A config directory holding a check that already found a newer release. */
function primed(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-update-e2e-"));
  writeFileSync(
    join(dir, "update-check.json"),
    JSON.stringify({ checkedAt: new Date().toISOString(), latest: "9999.0.0" }),
  );
  return dir;
}

test("⛔ the notice goes to stderr, so it cannot land in an answer something is parsing", async () => {
  const dir = primed();
  try {
    const { stdout, stderr } = await run(process.execPath, [MAIN, "--version"], {
      env: { ...process.env, NMTS_CONFIG_DIR: dir, NMTS_NO_UPDATE_CHECK: "" },
    });
    assert.equal(stdout.trim(), VERSION, "stdout carried something other than the answer");
    assert.match(stderr, /9999\.0\.0 is published/, "the notice never appeared at all");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(`⛔ ${NO_CHECK_ENV_VAR} reaches the real command, not only the function`, async () => {
  const dir = primed();
  try {
    const { stdout, stderr } = await run(process.execPath, [MAIN, "--version"], {
      env: { ...process.env, NMTS_CONFIG_DIR: dir, [NO_CHECK_ENV_VAR]: "1" },
    });
    assert.equal(stdout.trim(), VERSION);
    assert.equal(stderr.trim(), "", "it printed anyway");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

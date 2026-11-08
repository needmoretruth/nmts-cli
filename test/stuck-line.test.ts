// The Discord line at the end of a failure (owner 2026-11-07 · E2: "if something goes wrong or an
// upload fails, send them to the Discord server to ask").
//
// ⛔ THESE RUN THE PROGRAM. The line is written by `main` after the command has failed, so only the
//    real process shows whether it is there, where it is, and that stdout did not get it.

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { testConfigDir } from "../src/credentials.ts";
import { STUCK_LINE } from "../src/exit.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function nmts(args: string[], env: Record<string, string>): Promise<Ran> {
  return new Promise<Ran>((done, failed) => {
    const child = spawn(process.execPath, [MAIN, ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", failed);
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * A server that answers, but not as an NMTS server does: a 404 with no body for every route — what
 * a wrong proxy or a half-deployed server looks like. (A 5xx would be right too, but the tool keeps
 * retrying those for its whole budget first, which is a minute and a half of waiting per test.)
 */
let server: Server;
let base = "";
before(async () => {
  server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function signedIn(name: string, run: (env: Record<string, string>) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  rmSync(dir, { recursive: true, force: true });
  grantConsents(dir, "plain-env");
  try {
    await run({ NMTS_CONFIG_DIR: dir, NMTS_ACCOUNT_CODE: await generateCode(), NMTS_API_KEY: "nmts_ak1_k1_test", NMTS_NO_UPDATE_CHECK: "1" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a failure on the server's side ends with the Discord line, after the error itself", async () => {
  await signedIn("stuck-server", async (env) => {
    const r = await nmts(["ls", "--server", base, "--network", "testnet"], env);
    assert.equal(r.code, 1, r.stderr);
    const lines = r.stderr.trimEnd().split("\n");
    assert.equal(lines.at(-1), STUCK_LINE);
    assert.match(lines[0] ?? "", /^nmts: /, "the error sentence no longer comes first");
    assert.match(STUCK_LINE, /https:\/\/discord\.gg\/HtrUwhb2Mz/);
    assert.ok(!r.stdout.includes("Discord"), "the line went to stdout");
  });
});

test("a usage error does not get the line: the next keystroke fixes it", async () => {
  const unknown = await nmts(["frobnicate"], {});
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command/);
  assert.ok(!unknown.stderr.includes("Discord"), unknown.stderr);
  await signedIn("stuck-usage", async (env) => {
    // The pair: the same command, spelled right, fails on the server and DOES get the line — so
    // what keeps it off the mistyped one is the rule, not an absent feature.
    const option = await nmts(["ls", "--serverr", base, "--network", "testnet"], env);
    assert.equal(option.code, 2);
    assert.ok(!option.stderr.includes("Discord"), option.stderr);
    const spelled = await nmts(["ls", "--server", base, "--network", "testnet"], env);
    assert.ok(spelled.stderr.includes(STUCK_LINE), spelled.stderr);
  });
});

test("with --json the same failure prints no line anywhere, and stdout stays JSON or empty", async () => {
  await signedIn("stuck-json", async (env) => {
    // The pair: the same failure without --json DOES get the line, so this is not passing by default.
    const plain = await nmts(["ls", "--server", base, "--network", "testnet"], env);
    assert.ok(plain.stderr.includes(STUCK_LINE), plain.stderr);
    const json = await nmts(["ls", "--json", "--server", base, "--network", "testnet"], env);
    assert.equal(json.code, 1, json.stderr);
    assert.ok(!json.stderr.includes("Discord"), json.stderr);
    assert.ok(!json.stdout.includes("Discord"), json.stdout);
    if (json.stdout.trim() !== "") JSON.parse(json.stdout);
  });
});

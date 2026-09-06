// The tier table and the gate: every command has an act, and each tier meets each mode the way
// the table says.
//
// ⛔ THE TWO THAT MATTER MOST: a command with no tier is a command nobody decided about, so the
//    entry point and the table are held together here; and an ultra-high act in an auto mode is
//    refused whatever is unlocked — a regression there is an erased account nobody typed for.

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseArgs } from "../src/args.ts";
import { setMode, type Autonomy } from "../src/autonomy.ts";
import { grant } from "../src/consent.ts";
import { NmtsError } from "../src/errors.ts";
import { gate } from "../src/gate.ts";
import { ACTS, ACT_IDS, actOf, type ActId } from "../src/risk.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-risk-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

test("⛔ every command the entry point dispatches has an act, and every act has a tier", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const commands = [...main.matchAll(/^\s*case "([a-z-]+)":/gmu)].map((m) => m[1] ?? "");
  assert.ok(commands.length > 40, `parsed only ${commands.length} commands from main.ts — the parser broke`);
  const missing = commands.filter((c) => actOf(parseArgs([c])) === null);
  assert.deepEqual(missing, [], `commands with no act: ${missing.join(", ")}`);
  for (const id of ACT_IDS) assert.ok(["none", "low", "medium", "high", "ultra-high"].includes(ACTS[id].tier), id);
});

test("an act is what is DONE, not the command word", () => {
  assert.equal(actOf(parseArgs(["devices"])), "devices");
  assert.equal(actOf(parseArgs(["devices", "--sign-out", "a"])), "devices.sign-out");
  assert.equal(actOf(parseArgs(["wallet", "send", "SUI", "1", "0xabc"])), "wallet.send");
  assert.equal(actOf(parseArgs(["wallet", "donate", "SUI", "1"])), "wallet.donate");
  assert.equal(actOf(parseArgs(["put", "a.txt", "--pay", "wallet"])), "put.wallet");
  assert.equal(actOf(parseArgs(["put", "a.txt"])), "put");
  assert.equal(actOf(parseArgs(["whoami", "--reveal"])), "whoami.reveal");
  assert.equal(actOf(parseArgs(["login", "--plain"])), "login.plain");
  assert.equal(actOf(parseArgs(["key", "new"])), "key.new");
  assert.equal(actOf(parseArgs(["frobnicate"])), null);
});

/** Run the gate for one act under one mode, with nothing unlocked unless said, and say what happened. */
async function outcome(
  act: ActId,
  mode: Autonomy,
  extra: { yes?: boolean; reason?: string; unlocked?: boolean; answer?: string } = {},
): Promise<"ran" | "asks-itself" | `refused:${number}` | "asked-y" | "asked-n"> {
  const dir = isolate();
  try {
    setMode(mode, "t", new Date("2026-09-06T00:00:00Z"));
    const a = ACTS[act];
    if (extra.unlocked === true && "lock" in a && a.lock !== "wallet") grant(a.lock, "t", new Date());
    const argv = [act.split(".")[0] ?? act];
    if (extra.yes) argv.push("--yes");
    if (extra.reason !== undefined) argv.push("--reason", extra.reason);
    const args = parseArgs(argv);
    const asked: string[] = [];
    try {
      const passage = await gate(act, args, {
        write: () => {},
        ...(extra.answer === undefined ? {} : { readLine: async (q: string) => (asked.push(q), extra.answer ?? "") }),
      });
      if (asked.length > 0) return "asked-y";
      return passage.ask ? "asks-itself" : "ran";
    } catch (e) {
      if (e instanceof NmtsError) {
        if (asked.length > 0) return "asked-n";
        return `refused:${e.exitCode}`;
      }
      throw e;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("none runs everywhere without a word", async () => {
  for (const mode of ["default", "auto-low", "auto-high", "skip-permissions"] as const) {
    assert.equal(await outcome("ls", mode), "ran", mode);
  }
});

test("low and medium: default asks, the auto modes run", async () => {
  for (const act of ["rm", "put"] as const) {
    assert.equal(await outcome(act, "default"), "refused:5", `${act} ran in default with nobody asked`);
    assert.equal(await outcome(act, "default", { yes: true }), "ran", `${act} --yes was not enough`);
    assert.equal(await outcome(act, "default", { answer: "y" }), "asked-y");
    assert.equal(await outcome(act, "default", { answer: "" }), "asked-n");
    assert.equal(await outcome(act, "auto-low"), "ran");
    assert.equal(await outcome(act, "auto-high"), "ran");
    assert.equal(await outcome(act, "skip-permissions"), "ran");
  }
});

test("⛔ high is locked until unlocked, then asked about in every mode but skip", async () => {
  assert.equal(await outcome("whoami.reveal", "default"), "refused:5", "locked, and it ran");
  assert.equal(await outcome("whoami.reveal", "auto-low", { yes: true }), "refused:5", "locked, and --yes opened it");
  assert.equal(await outcome("whoami.reveal", "default", { unlocked: true, answer: "y" }), "asked-y");
  assert.equal(await outcome("whoami.reveal", "auto-low", { unlocked: true }), "refused:5", "auto ran a high act unasked");
  assert.equal(await outcome("whoami.reveal", "auto-high", { unlocked: true, yes: true }), "ran");
  assert.equal(await outcome("whoami.reveal", "skip-permissions"), "ran", "skip-permissions was refused");
  // An act that asks itself is told a yes is still needed, and asks in its own words.
  assert.equal(await outcome("devices.sign-out", "auto-low", { unlocked: true }), "asks-itself");
  assert.equal(await outcome("devices.sign-out", "auto-low", { unlocked: true, yes: true }), "ran");
});

test("⛔ ultra-high: a person in default, never an auto mode, skip only with a written reason", async () => {
  assert.equal(await outcome("delete-account", "default"), "asks-itself");
  assert.equal(await outcome("delete-account", "auto-low", { yes: true }), "refused:5");
  assert.equal(await outcome("delete-account", "auto-high", { yes: true }), "refused:5");
  assert.equal(await outcome("delete-account", "skip-permissions"), "refused:5", "skip ran it with no reason");
  assert.equal(await outcome("delete-account", "skip-permissions", { reason: "the person asked for it in writing" }), "ran");
});

test("a gift is high: locked behind `donate`, then asked on every run — the owner set the tier, 2026-09-06", async () => {
  assert.equal(await outcome("wallet.donate", "default"), "refused:5", "locked, and it ran");
  assert.equal(await outcome("wallet.donate", "default", { unlocked: true }), "asks-itself");
  assert.equal(await outcome("wallet.donate", "auto-low", { unlocked: true }), "asks-itself");
  assert.equal(await outcome("wallet.donate", "auto-low", { unlocked: true, yes: true }), "ran");
  assert.equal(await outcome("wallet.donate", "skip-permissions"), "ran");
});

// The MCP surface carries the tier table: every served tool has a row, and the gate around each
// tool refuses, asks, or passes the way the command line does.

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { mcpToolSchemas } from "../src/commands/mcp.ts";
import { grant } from "../src/consent.ts";
import { TOOL_TIERS, annotationsOf, passTool, withTiers } from "../src/mcp-tools/tiers.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-mcp-tiers-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

test("⛔ every served tool has a tier row, and every row names a served tool", () => {
  const served = mcpToolSchemas().map((t) => t.name).sort();
  assert.deepEqual(Object.keys(TOOL_TIERS).sort(), served);
});

test("the listing says which tools only read", () => {
  assert.equal(annotationsOf("nmts_list").readOnlyHint, true);
  assert.equal(annotationsOf("nmts_put").readOnlyHint, false);
  assert.equal(annotationsOf("nmts_share").destructiveHint, true);
  assert.equal(annotationsOf("nmts_trash").destructiveHint, false);
});

test("a read passes in every mode without a question", async () => {
  let asked = 0;
  for (const mode of ["default", "auto-low", "auto-high", "skip-permissions"] as const) {
    assert.equal(await passTool("nmts_list", {}, mode, () => (asked += 1, Promise.resolve("no"))), null, mode);
  }
  assert.equal(asked, 0);
});

test("medium: the default mode asks, the auto modes pass, a dry run is not the act", async () => {
  assert.match(String(await passTool("nmts_put", { file: "a" }, "default", null)), /--yes/);
  assert.equal(await passTool("nmts_put", { file: "a" }, "default", () => Promise.resolve("yes")), null);
  assert.match(String(await passTool("nmts_put", { file: "a" }, "default", () => Promise.resolve("no"))), /did not confirm/);
  assert.equal(await passTool("nmts_put", { file: "a", dry_run: true }, "default", null), null);
  assert.equal(await passTool("nmts_put", { file: "a" }, "auto-low", null), null);
  assert.equal(await passTool("nmts_put", { file: "a" }, "skip-permissions", null), null);
});

test("⛔ high: locked until a person unlocks it, then asked in every mode but skip-permissions", async () => {
  const dir = isolate();
  try {
    const args = { path: "reports/q3.pdf", public_code: "PUB-1234" };
    assert.match(String(await passTool("nmts_share", args, "auto-low", () => Promise.resolve("yes"))), /nmts unlock share/);
    grant("share", "t", new Date());
    let asked = "";
    assert.equal(await passTool("nmts_share", args, "auto-high", (m) => ((asked = m), Promise.resolve("yes"))), null);
    assert.match(asked, /reports\/q3\.pdf/);
    assert.match(asked, /PUB-1234/);
    assert.match(String(await passTool("nmts_share", args, "auto-low", null)), /cannot put a question/);
    assert.equal(await passTool("nmts_share", args, "skip-permissions", null), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one tool reads or sets, and the act follows the arguments", async () => {
  assert.equal(await passTool("nmts_padding", {}, "default", null), null);
  assert.match(String(await passTool("nmts_padding", { mode: "pow2" }, "default", null)), /needs the person's yes/);
});

test("the wrapper puts the tier before the description and the gate before the run", async () => {
  let ran = 0;
  const [tool] = withTiers(
    [{ name: "nmts_put", description: "Upload.", inputSchema: {}, run: async () => ((ran += 1), "done") }],
    () => null,
  );
  assert.ok(tool !== undefined);
  assert.match(tool.description, /^Tier medium: .*Upload\.$/);
  assert.equal(tool.annotations?.["readOnlyHint"], false);
  assert.match(await tool.run({ file: "a" }), /Refused/);
  assert.equal(ran, 0);
});

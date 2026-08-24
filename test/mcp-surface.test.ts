// Which tools this program actually serves, and whether their schemas can be enforced.
//
// ⛔ SEPARATE FROM THE TRANSPORT TESTS ON PURPOSE. `mcp.test.ts` drives the protocol against tools
//    invented for the test; these two read the REAL table. Both matter, and mixing them made one
//    file long enough that the length gate refused it — which is the honest reason, and splitting
//    on that line is the split that means something rather than a cut at a line number.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { mcpToolSchemas } from "../src/commands/mcp.ts";
import { unsupported } from "../src/mcp-args.ts";

test("⛔ every tool this program serves declares a schema the argument check can judge", () => {
  // ⛔ The check at the transport only holds a tool whose schema it UNDERSTANDS. A tool that grew
  //    a keyword outside that subset would go on being advertised while nothing enforced it, and
  //    nothing would say so. This compares the REAL tool table — built, not restated — against
  //    what the checker handles, as a set.
  const declared = mcpToolSchemas();
  assert.ok(declared.length >= 10, `only ${declared.length} tools were found — the walk is blind`);
  const unjudgeable = declared
    .map((t) => ({ name: t.name, keywords: unsupported(t.inputSchema) }))
    .filter((t) => t.keywords.length > 0);
  assert.deepEqual(unjudgeable, [], "these tools declare something the argument check cannot judge");
});

test("⛔ nothing a machine must not do is in the surface, and the reads that are safe all are", () => {
  // ⛔ A SET, NOT A COUNT. "Seventeen tools" stays true while the wrong seventeen are there. The
  //    names below are the decision this surface encodes: what a model may drive, and what stays
  //    a person's — credentials, consent, the human check, permanent destruction, and the
  //    disaster-recovery artefacts that exist for the day this service does not.
  const names = mcpToolSchemas().map((t) => t.name).sort();
  assert.deepEqual(names, [
    "nmts_balance",
    "nmts_expiring",
    "nmts_get",
    "nmts_list",
    "nmts_mark",
    "nmts_mkdir",
    "nmts_move",
    "nmts_public_code",
    "nmts_pull",
    "nmts_push",
    "nmts_put",
    "nmts_receive",
    "nmts_rename",
    "nmts_restore",
    "nmts_share",
    "nmts_shares",
    "nmts_trash",
    "nmts_unshare",
    "nmts_usage",
    "nmts_whoami",
  ]);
  for (const forbidden of ["verify", "login", "logout", "consent", "sweep", "rebuild", "env", "mcp"]) {
    assert.ok(
      !names.includes(`nmts_${forbidden}`),
      `${forbidden} is something a person decides, and it is now reachable by a model`,
    );
  }
});

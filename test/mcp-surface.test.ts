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
  // ⛔ `create` AND `trial` WERE JUDGED AND LEFT OUT (2026-08-24), and this line is the judgement.
  //    Making an ACCOUNT hands back a code that is the only key that account will ever have, and a
  //    tool's answer goes straight into a model's context and whatever transcript is kept of it —
  //    the one place this program spends its whole design keeping that value out of. The account
  //    it would create is also recorded as accepting two documents, and a model calling a tool is
  //    not a person consenting. The free TRIAL is the giveaway's own surface: the server asks
  //    every application for a fresh browser check no tool can produce, so a model could only ever
  //    drive it into a refusal, and asking for something for nothing on somebody's behalf is not a
  //    step to take without them. Both stay commands a person runs.
  for (const forbidden of [
    "verify",
    "login",
    "logout",
    "consent",
    "sweep",
    "rebuild",
    "env",
    "mcp",
    "create",
    "trial",
  ]) {
    assert.ok(
      !names.includes(`nmts_${forbidden}`),
      `${forbidden} is something a person decides, and it is now reachable by a model`,
    );
  }
});

test("⛔ nothing that signs a chain transaction is in the surface", () => {
  // ⛔ ITS OWN TEST, WITH ITS OWN REASON. The list above is about decisions that belong to a
  //    person; this is about the one command that spends from a WALLET. `nmts extend` signs a
  //    transaction that moves real assets on a public chain, and nobody — NMTS included — can
  //    reverse it. Credits are a promise this service made and can be argued about afterwards; WAL
  //    is not. So a model may ask what is running out (`nmts_expiring`) and may not pay for it.
  //
  // ⚠ IT IS A SET CHECK, NOT A NAME BAN. Anything that reaches the signer would have to be served
  //   under some name, and a tool table that grew one would fail the assertion above it, which
  //   compares the WHOLE list against the decision this surface encodes. This says out loud why
  //   `nmts_extend` is not in that list, so that adding it has to be an argument rather than an
  //   oversight.
  const names = mcpToolSchemas().map((t) => t.name);
  for (const forbidden of ["extend", "wallet", "recovery"]) {
    assert.ok(
      !names.includes(`nmts_${forbidden}`),
      `${forbidden} is not something a model does on somebody's behalf, and it is now reachable by one`,
    );
  }
});

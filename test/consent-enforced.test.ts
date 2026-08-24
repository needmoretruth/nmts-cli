// Does every consent key this tool DECLARES actually stop something?
//
// ⛔ THE DOCUMENTATION COUNTED FOUR AND THE CODE ENFORCED THREE. `wallet` has been declared since
//    the ladder was written, `nmts consent` prints it, and both README and AGENTS.md describe a
//    tool that stops to ask before signing — while no line anywhere calls `requireConsent`
//    for it, because no command signs anything yet. Nobody was misled into danger by that; the
//    danger is the other direction. A key that is declared and never enforced teaches a reader
//    that the ladder is a list of topics rather than a list of gates, and the day a signing
//    command lands, "wallet is already in the ladder" is exactly the sentence that lets it ship
//    without one.
//
// ⛔ SO THE GATE COMPARES SETS, NOT COUNTS. A count is satisfied by any four things; a set is
//    satisfied only by the right four. Declaring a key without enforcing it stays possible —
//    the tool is built in pieces and a key sometimes lands before its command — but it costs a
//    line HERE, with a reason, which is the difference between a decision and an oversight.
//
// ⚠ WHAT THIS CANNOT DO. It reads source text, so it proves a call site exists, not that the
//   call site is on the path that matters. A command could ask for the wrong key, or ask after
//   doing the thing. That is a person's read, and the tests beside each command are where it
//   lives.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONSENT_KEYS, type ConsentKey } from "../src/consent.ts";

const SRC = join(fileURLToPath(new URL("../src", import.meta.url)));

/**
 * Keys that are declared on purpose without a caller yet, and why.
 *
 * ⛔ A REASON, NOT A NAME. An allowlist of bare names is a list of things somebody once decided
 *    to ignore; a reason is something the next reader can check and delete.
 */
const DECLARED_WITHOUT_A_CALLER: Partial<Record<ConsentKey, string>> = {
  wallet:
    "No command signs a chain transaction yet. The key is declared so that the command which " +
    "does cannot be written without one, and so the ladder does not change shape under a person " +
    "who has already read it. Delete this line in the same change that adds the first signer.",
};

/** Every `.ts` file the tool itself is made of — not the copied browser library, not the tests. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    // ⛔ `shared/` is copied byte for byte from the browser and a gate compares it. It cannot
    //    contain a call to this tool's consent ladder, and walking into it would only make this
    //    test slower and its failures more confusing.
    if (name === "shared") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith(".ts") && name !== "consent.ts") out.push(full);
  }
  return out;
}

function enforcedKeys(): Set<string> {
  const found = new Set<string>();
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/requireConsent\(\s*"([^"]+)"/gu)) {
      const key = m[1];
      if (key !== undefined) found.add(key);
    }
  }
  return found;
}

test("every declared consent key is enforced somewhere, or says here why it is not", () => {
  const enforced = enforcedKeys();
  const missing = CONSENT_KEYS.filter(
    (k) => !enforced.has(k) && DECLARED_WITHOUT_A_CALLER[k] === undefined,
  );
  assert.deepEqual(
    missing,
    [],
    `declared but nothing requires it, and no reason is recorded: ${missing.join(", ")}`,
  );
});

test("the recorded exceptions are still exceptions", () => {
  // ⛔ THE OTHER DIRECTION MATTERS TOO. Once a signing command lands and calls for `wallet`, the
  //    line above becomes false — and a stale exemption is how a gate stops judging the thing it
  //    was built for.
  const enforced = enforcedKeys();
  const stale = Object.keys(DECLARED_WITHOUT_A_CALLER).filter((k) => enforced.has(k));
  assert.deepEqual(stale, [], `now enforced, so delete the exception: ${stale.join(", ")}`);
});

test("nothing asks for a consent key that does not exist", () => {
  // A typo'd key would compile — `requireConsent` takes a union, but a string literal that does
  // not match simply fails the type check, so this catches the case where somebody widens the
  // signature or reaches the record through another path.
  const declared = new Set<string>(CONSENT_KEYS);
  const unknown = [...enforcedKeys()].filter((k) => !declared.has(k));
  assert.deepEqual(unknown, [], `asked for but not declared: ${unknown.join(", ")}`);
});

test("the gate can see call sites at all", () => {
  // ⛔ A SCAN THAT MATCHES NOTHING PASSES EVERY ASSERTION ABOVE. If the call spelling changes —
  //    a wrapper, a different quote style, a computed key — this test goes red and the three
  //    above stay silently green. "0 found" is the failure mode of every gate that counts.
  const enforced = enforcedKeys();
  assert.ok(
    enforced.size >= 2,
    `found ${enforced.size} call sites, so the scan is not reading the source it thinks it is`,
  );
});

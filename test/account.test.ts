// The crypto chain, end to end, in Node: a code in, an identity out, with the real engine.
//
// ⛔ THE ENGINE IS NOT MOCKED. The point of these tests is that the SAME WebAssembly the browser
//    runs derives the same values here. A fake would prove only that this file agrees with itself.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertUsableCode, identityOf } from "../src/account.ts";
import { generateCode } from "./helpers.ts";
import { DERIVED, loadCrypto } from "../src/crypto.ts";
import { NmtsError } from "../src/errors.ts";

test("the real engine loads in Node and has every function this tool calls", async () => {
  const glue = await loadCrypto();
  for (const name of ["account_code_parse", "account_code_display", "kdf_derive", "share_address_display"]) {
    assert.equal(typeof Reflect.get(glue, name), "function", `engine is missing ${name}`);
  }
});

test("a generated code derives an account id and a public code", async () => {
  const identity = await identityOf(await generateCode());
  // 16 bytes as base64url is 22 characters with no padding.
  assert.match(identity.accountId, /^[A-Za-z0-9_-]{22}$/);
  // The share address is grouped Crockford Base32 with a trailing check symbol.
  assert.match(identity.publicCode, /^[0-9A-Z]{9}-[0-9A-Z]{9}-[0-9A-Z]{8}[0-9A-Z*~$=U]$/);
});

test("the same code always derives the same identity — the derivation is not random", async () => {
  const code = await generateCode();
  const a = await identityOf(code);
  const b = await identityOf(code);
  assert.deepEqual(a, b);
});

test("two different codes derive different identities", async () => {
  const a = await identityOf(await generateCode());
  const b = await identityOf(await generateCode());
  assert.notEqual(a.accountId, b.accountId);
  assert.notEqual(a.publicCode, b.publicCode);
});

test("⛔ a one-character change is REFUSED — the check symbol is what makes a typo visible", async () => {
  const code = await generateCode();
  // Flip the first data character to a different symbol in the same alphabet.
  const flipped = (code[0] === "0" ? "1" : "0") + code.slice(1);
  await assert.rejects(() => assertUsableCode(flipped), NmtsError);
});

test("a refusal never repeats the code back", async () => {
  const bogus = "SECRETLOOKINGGARBAGE9999";
  try {
    await assertUsableCode(bogus);
    assert.fail("a malformed code was accepted");
  } catch (error) {
    assert.ok(!String(error).includes(bogus), "the error message carried the input");
  }
});

test("nothing secret comes out of identityOf — only the two public values and the display form", async () => {
  // The derivation produces the auth secret and the data key. This asserts the shape that is
  // returned, so adding a field that carries key material fails here rather than in review.
  const identity = await identityOf(await generateCode());
  assert.deepEqual(Object.keys(identity).sort(), ["accountId", "displayCode", "publicCode"]);
});

test("the derivation offsets do not overlap and are in the order the format states", () => {
  const ranges = [DERIVED.accountId, DERIVED.authSecret, DERIVED.dataKey, DERIVED.shareAddress];
  for (let i = 1; i < ranges.length; i += 1) {
    const previous = ranges[i - 1];
    const current = ranges[i];
    assert.ok(previous !== undefined && current !== undefined);
    assert.ok(previous[1] <= current[0], `range ${i} starts before the previous one ends`);
  }
});

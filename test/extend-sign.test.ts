// The one module in this tool that can move somebody's assets.
//
// ⛔ WHAT CAN BE PROVED HERE, AND WHAT CANNOT. Nothing below signs a transaction or reaches a
//    chain: doing that for real costs WAL and a gas fee, and a test that spent money every time it
//    ran would be turned off within a week. What IS checked is the half that is free and is also
//    the half that fails silently — WHICH WALLET would sign. A signature made by a wallet the
//    account does not print is a signature from an address nobody funded, and the way that
//    surfaces without this test is a transaction refused for want of coins that are sitting in the
//    address the person was shown.
//
// ⚠ So: the derivation is held here, the request shape and the arithmetic are held in
//   `extend.test.ts`, and the signature itself is held by nothing. That is said plainly rather
//   than implied — see the header of `extend.test.ts`.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import * as signing from "../src/extend-sign.ts";
import { walletAddress } from "../src/wallet.ts";
import { generateCode } from "./helpers.ts";

test("⛔ the wallet that would sign is the wallet this account prints", async () => {
  const code = await generateCode();
  const printed = await walletAddress(code);
  const signing_ = await signing.signerAddress(code);
  assert.equal(
    signing_,
    printed,
    "the signer derives a different wallet from the one `nmts wallet address` shows",
  );
  // A second run must land on the same address: a derivation with anything random in it would
  // produce a wallet nobody can find again, and the money would be gone rather than misplaced.
  assert.equal(await signing.signerAddress(code), printed);
});

test("⛔ two accounts do not share a wallet", async () => {
  // ⛔ WITHOUT THIS, A DERIVATION THAT IGNORED ITS INPUT WOULD PASS THE TEST ABOVE — both sides
  //    would agree on one wrong constant. This is the input the comparison cannot fake.
  const [a, b] = await Promise.all([generateCode(), generateCode()]);
  assert.notEqual(await signing.signerAddress(a), await signing.signerAddress(b));
});

test("⛔ nothing here hands out a key", () => {
  // ⛔ A SET, NOT A COUNT. `wallet.ts` states the rule for the whole tool — no function returns a
  //    seed, a private key or a keypair — and this module is where breaking it would be easiest,
  //    because it has to build one. Anything new leaving this file is a decision that has to be
  //    made here, in the open, rather than by adding an export.
  assert.deepEqual(Object.keys(signing).sort(), ["signExtension", "signerAddress"]);
});

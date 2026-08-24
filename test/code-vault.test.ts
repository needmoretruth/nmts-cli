// Sealing the account code under a passphrase — the parts a command-level test cannot see.
//
// ⛔ WHY THIS FILE EXISTS. An adversarial review mutated `lockCode` into a base64 encoder and ran
//    the whole suite: 19 of 20 command-level tests stayed green. It then made the salt and the
//    nonce constants and got 20 of 20. Neither mutation is exotic — both are what a rushed
//    refactor produces — and neither was visible from outside, because from outside a sealed file
//    and a base64 one behave identically until somebody steals the file.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isLockedCode, lockCode, samePassphrase, unlockCode, type LockedCode } from "../src/code-vault.ts";
import { NmtsError } from "../src/errors.ts";

const CODE = "NMTS-TEST-CODE-NOT-AN-ACCOUNT";
const PASS = "correct horse battery staple";

test("what is sealed comes back, and only with the right passphrase", () => {
  const locked = lockCode(CODE, PASS);
  assert.equal(unlockCode(locked, PASS), CODE);
  const wrong = (() => {
    try {
      unlockCode(locked, "not the passphrase");
      return null;
    } catch (e: unknown) {
      return e;
    }
  })();
  assert.ok(wrong instanceof NmtsError, "a wrong passphrase returned something");
  assert.equal(wrong.name, "WrongPassphraseError");
});

test("⛔ the sealed form is not the code in any encoding", () => {
  const locked = lockCode(CODE, PASS);
  const whole = JSON.stringify(locked);
  assert.ok(!whole.includes(CODE), "the code is in the sealed record verbatim");
  for (const encoding of ["base64", "base64url", "hex", "utf8"] as const) {
    assert.ok(
      !whole.includes(Buffer.from(CODE, "utf8").toString(encoding)),
      `the sealed record is the code in ${encoding} — this is an encoder, not a seal`,
    );
  }
});

test("⛔ two seals of the SAME code and passphrase share no salt, no nonce and no ciphertext", () => {
  // The mutation this catches — constant salt, constant nonce — passed every other test in the
  // suite. A repeated nonce under one key is the failure that takes AES-GCM apart completely.
  const a = lockCode(CODE, PASS);
  const b = lockCode(CODE, PASS);
  assert.notEqual(a.salt, b.salt, "the salt is a constant");
  assert.notEqual(a.nonce, b.nonce, "the nonce is a constant");
  assert.notEqual(a.ct, b.ct, "two seals of one input are identical");
});

test("⛔ one flipped ciphertext byte is refused, not opened into something else", () => {
  const locked = lockCode(CODE, PASS);
  const bytes = Buffer.from(locked.ct, "base64");
  bytes[0] = bytes[0] === undefined ? 0 : bytes[0] ^ 0x01;
  assert.throws(() => unlockCode({ ...locked, ct: bytes.toString("base64") }, PASS), /passphrase/i);
});

test("⛔ the parameters are bound to the ciphertext — editing one fails closed", () => {
  const locked = lockCode(CODE, PASS);
  // ⛔ `n` HALVED IS A LEGAL, CHEAPER VALUE, so the cost gate lets it through and the derivation
  //    actually runs. It must then fail at the TAG — which is the whole claim the AAD makes. The
  //    error's NAME is what says which of the two rejected it, and a test that only asserted
  //    "something was thrown" could not tell "the binding works" from "the bound is too tight".
  const thrown = (() => {
    try {
      unlockCode({ ...locked, n: locked.n / 2 }, PASS);
      return null;
    } catch (e: unknown) {
      return e;
    }
  })();
  assert.ok(thrown instanceof NmtsError);
  assert.equal(thrown.name, "WrongPassphraseError", `rejected by ${thrown.name}, not by the tag`);
});

test("⛔ a cost above what this version writes is refused BEFORE any work is done", () => {
  const locked = lockCode(CODE, PASS);
  // ⛔ THE ONE AN ADVERSARIAL REVIEW MEASURED AT 39 MINUTES. `p` was unbounded, and the tag that
  //    would have rejected the edit is checked only at the END of the derivation.
  const started = Date.now();
  assert.throws(() => unlockCode({ ...locked, p: 81_918 }, PASS), NmtsError);
  assert.ok(Date.now() - started < 1_000, "it did the work before deciding the file was wrong");

  for (const bad of [{ n: locked.n * 4 }, { r: locked.r * 4 }, { n: 2 }, { n: locked.n + 1 }]) {
    assert.throws(() => unlockCode({ ...locked, ...bad }, PASS), NmtsError, JSON.stringify(bad));
  }
});

test("⛔ a cost BELOW what this version writes reaches the derivation, and is not refused", () => {
  // Discriminating in the other direction: a bound that refused everything cheaper would pass
  // every assertion above and strand anybody whose file was written before the cost was raised.
  // The cheaper record cannot carry a matching tag (the AAD names its parameters), so what proves
  // it was ALLOWED is which error comes back.
  const locked = lockCode(CODE, PASS);
  for (const cheaper of [{ n: locked.n / 4 }, { p: 1 }, { r: 4 }]) {
    const thrown = (() => {
      try {
        unlockCode({ ...locked, ...cheaper }, PASS);
        return null;
      } catch (e: unknown) {
        return e;
      }
    })();
    assert.ok(thrown instanceof NmtsError);
    assert.equal(thrown.name, "WrongPassphraseError", `${JSON.stringify(cheaper)} was refused by the cost gate`);
  }
});

test("a record that is not this format is rejected by shape, not by exception", () => {
  for (const bad of [null, 1, "x", {}, { v: 2, kdf: "scrypt", n: 1, r: 1, p: 1, salt: "", nonce: "", ct: "" }]) {
    assert.equal(isLockedCode(bad), false, JSON.stringify(bad));
  }
  assert.equal(isLockedCode(lockCode(CODE, PASS) as unknown), true);
});

test("an empty passphrase locks nothing and says so", () => {
  assert.throws(() => lockCode(CODE, ""), NmtsError);
});

test("two passphrases are the same only when they are", () => {
  assert.equal(samePassphrase("abc", "abc"), true);
  assert.equal(samePassphrase("abc", "abd"), false);
  assert.equal(samePassphrase("abc", "abcd"), false);
  assert.equal(samePassphrase("", ""), true);
});

test("⛔ a truncated ciphertext is a refusal, not a crash", () => {
  const locked: LockedCode = lockCode(CODE, PASS);
  assert.throws(() => unlockCode({ ...locked, ct: "AAAA" }, PASS), /passphrase/i);
  assert.throws(() => unlockCode({ ...locked, salt: "AAAA" }, PASS), /passphrase/i);
  assert.throws(() => unlockCode({ ...locked, nonce: "AAAA" }, PASS), /passphrase/i);
});

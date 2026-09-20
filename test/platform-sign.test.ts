// The wire format of the two Platform credentials, held to fixed bytes.
//
// ⛔ THE EXPECTED VALUES ARE LITERALS, NOT WHAT THE CODE PRODUCES TODAY. A test that signed with
//    the module and verified with the module would pass over any change to the layout at all —
//    and the layout is what a server written in another language has to agree with, byte for byte.
//    So the message is spelled out here a second time, by hand, from the format itself, and the
//    finished credential is frozen as a string.
//
// ⛔ AND THE KEY IS FIXED. Ed25519 signing is deterministic, so one seed and one message have
//    exactly one signature: any drift in the context string, the separators, the digest spelling
//    or the field order turns these red.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { fromBase64Url, toBase64Url, utf8 } from "../src/bytes.ts";
import { NmtsError } from "../src/errors.ts";
import {
  businessPublicKey,
  businessSigningInput,
  DELEGATION_MAX_TTL_SECS,
  delegationSigningInput,
  generateBusinessKeys,
  mintDelegation,
  rotationProof,
  rotationSigningInput,
  scopeMask,
  signatureHolds,
  signBusinessRequest,
} from "../src/platform-sign.ts";

/** A key pair nobody owns: 32 bytes of 7, so the values below can be written down. */
const PRIVATE_KEY = toBase64Url(new Uint8Array(32).fill(7));
/** The account ids are 16 bytes, base64url, exactly as the server spells them. */
const BUSINESS = toBase64Url(new Uint8Array(16).fill(1));
const USER = toBase64Url(new Uint8Array(16).fill(2));
const NONCE = toBase64Url(new Uint8Array(16).fill(3));

test("a private key answers one public key, and it is the curve's", () => {
  assert.equal(businessPublicKey(PRIVATE_KEY), toBase64Url(ed25519.getPublicKey(fromBase64Url(PRIVATE_KEY))));
  const made = generateBusinessKeys();
  assert.equal(businessPublicKey(made.privateKey), made.publicKey);
  assert.equal(fromBase64Url(made.privateKey).length, 32);
  assert.notEqual(made.privateKey, generateBusinessKeys().privateKey, "two pairs came out the same");
});

test("⛔ a business signature covers the context, the moment, the nonce, the method, the path and the body", () => {
  const body = utf8(`{"pubkey":"x"}`);
  // Spelled out from the format rather than taken from the module: newline-separated fields, the
  // nonce as the text that travels, the method upper-cased, and the body as lower-case hex SHA-256.
  const byHand =
    "nmts/p1/business/v1\n" +
    "1700000000\n" +
    NONCE +
    "\n" +
    "PUT\n" +
    "/p1/business/key\n" +
    bytesToHex(sha256(body));
  assert.deepEqual(businessSigningInput(1_700_000_000, NONCE, "put", "/p1/business/key", body), utf8(byHand));

  const bearer = signBusinessRequest({
    accountId: BUSINESS,
    privateKey: PRIVATE_KEY,
    method: "PUT",
    path: "/p1/business/key",
    body,
    at: 1_700_000_000,
    nonce: NONCE,
  });
  assert.equal(
    bearer,
    "nmts_bs1_AQEBAQEBAQEBAQEBAQEBAQ.1700000000.AwMDAwMDAwMDAwMDAwMDAw." +
      "CCDZ7Rri7bQJPhFKgcfzGLPi_An_tLle-5gbNxYmc3H6EPEYVElQtmHjyID6o2RhsMfnRo6DrG-Ss4asqSkaCA",
  );
  const [, , nonce, signature] = bearer.split(".");
  assert.equal(nonce, NONCE);
  assert.ok(signature !== undefined);
  assert.ok(signatureHolds(businessPublicKey(PRIVATE_KEY), utf8(byHand), signature));
});

test("a GET signs the digest of no body at all", () => {
  const bearer = signBusinessRequest({
    accountId: BUSINESS,
    privateKey: PRIVATE_KEY,
    method: "GET",
    path: "/p1/business",
    at: 42,
    nonce: NONCE,
  });
  const [, ts, nonce, signature] = bearer.split(".");
  assert.equal(ts, "42");
  assert.equal(nonce, NONCE);
  assert.ok(signature !== undefined);
  assert.ok(
    signatureHolds(
      businessPublicKey(PRIVATE_KEY),
      businessSigningInput(42, NONCE, "GET", "/p1/business", new Uint8Array(0)),
      signature,
    ),
  );
});

test("⛔ a different body, method, path, moment or nonce is a different signature", () => {
  const base = { accountId: BUSINESS, privateKey: PRIVATE_KEY, method: "POST", path: "/p1/users", at: 99, nonce: NONCE };
  const one = signBusinessRequest({ ...base, body: utf8("one") });
  for (const other of [
    signBusinessRequest({ ...base, body: utf8("two") }),
    signBusinessRequest({ ...base, method: "PUT", body: utf8("one") }),
    signBusinessRequest({ ...base, path: "/p1/business", body: utf8("one") }),
    signBusinessRequest({ ...base, at: 100, body: utf8("one") }),
    signBusinessRequest({ ...base, nonce: toBase64Url(new Uint8Array(16).fill(4)), body: utf8("one") }),
  ]) {
    assert.notEqual(one, other);
  }
});

test("⛔ two identical requests in the same second are two credentials", () => {
  // The whole reason the nonce exists: Ed25519 is deterministic and the moment is whole seconds,
  // so without a drawn nonce the second of these would be the first, byte for byte.
  const same = { accountId: BUSINESS, privateKey: PRIVATE_KEY, method: "GET", path: "/p1/business", at: 99 } as const;
  assert.notEqual(signBusinessRequest({ ...same }), signBusinessRequest({ ...same }));
  const drawn = signBusinessRequest({ ...same }).split(".");
  assert.equal(drawn.length, 4);
  const nonce = drawn[2];
  assert.ok(nonce !== undefined);
  assert.equal(fromBase64Url(nonce).length, 16);
});

test("⛔ a delegation token signs the payload bytes that travel, and says what it may do", () => {
  const token = mintDelegation({
    business: BUSINESS,
    user: USER,
    privateKey: PRIVATE_KEY,
    scope: ["files_read", "files_write"],
    ttlSecs: 3_600,
    at: 1_700_000_000,
    nonce: NONCE,
  });
  assert.equal(
    token,
    "nmts_dt1_eyJ2IjoxLCJiIjoiQVFFQkFRRUJBUUVCQVFFQkFRRUJBUSIsInUiOiJBZ0lDQWdJQ0FnSUNBZ0lDQWdJ" +
      "Q0FnIiwiZXhwIjoxNzAwMDAzNjAwLCJzIjozLCJuIjoiQXdNREF3TURBd01EQXdNREF3TURBdyJ9." +
      "r2o5zrlbER_296YiMogLtCBag1WPg6zsXHJU_BdOVlTbl_e1A-kbbeNoJISYEfJmmBqeZtkwng5EpbwFf0UiAw",
  );
  const [head, signature] = token.slice("nmts_dt1_".length).split(".");
  assert.ok(head !== undefined && signature !== undefined);
  const payload = fromBase64Url(head);
  // The payload is read back as the server reads it: the bytes that arrived, parsed once.
  assert.deepEqual(JSON.parse(new TextDecoder().decode(payload)), {
    v: 1,
    b: BUSINESS,
    u: USER,
    exp: 1_700_003_600,
    s: 3,
    n: NONCE,
  });
  // ⚠ The context is in front of the payload with one newline; verifying over the bare payload
  //   would be a token any context could claim.
  assert.deepEqual(delegationSigningInput(payload), new Uint8Array([...utf8("nmts/p1/delegation/v1\n"), ...payload]));
  assert.ok(signatureHolds(businessPublicKey(PRIVATE_KEY), delegationSigningInput(payload), signature));
  assert.ok(!signatureHolds(businessPublicKey(PRIVATE_KEY), payload, signature), "the context was not covered");
});

test("the five scope names are the five bits, and no scope at all is refused", () => {
  assert.equal(scopeMask(["files_read"]), 1);
  assert.equal(scopeMask(["files_write"]), 2);
  assert.equal(scopeMask(["storage_spend"]), 4);
  assert.equal(scopeMask(["register"]), 8);
  // ⛔ ERASING FOR GOOD IS ITS OWN BIT AND NOT PART OF `files_write`: a token minted so an app can
  //    upload must not be able to destroy.
  assert.equal(scopeMask(["files_erase"]), 16);
  assert.equal(scopeMask(["files_read", "files_write", "storage_spend", "register", "files_erase"]), 31);
  assert.throws(() => scopeMask([]), NmtsError);
});

test("two tokens with the same fields are different strings", () => {
  const same = { business: BUSINESS, user: USER, privateKey: PRIVATE_KEY, scope: ["files_read"] as const, ttlSecs: 60, at: 1 };
  assert.notEqual(mintDelegation({ ...same }), mintDelegation({ ...same }));
});

test("⛔ a life longer than thirty days is refused where it is minted", () => {
  const ask = (ttlSecs: number): string =>
    mintDelegation({ business: BUSINESS, user: USER, privateKey: PRIVATE_KEY, scope: ["files_read"], ttlSecs });
  assert.ok(ask(DELEGATION_MAX_TTL_SECS).startsWith("nmts_dt1_"));
  assert.throws(() => ask(DELEGATION_MAX_TTL_SECS + 1), /30 days/);
  assert.throws(() => ask(0), NmtsError);
});

test("⛔ a rotation proof names the key it replaces, so it cannot be lifted onto another", () => {
  const old = businessPublicKey(toBase64Url(new Uint8Array(32).fill(9)));
  const next = PRIVATE_KEY;
  const proof = rotationProof(old, next);
  assert.equal(
    proof,
    "cuNyzaIJ7FmRlFcO3yfr2WTVJ2OFf-kOYoBr6F5KTHGhMJcauDN9G2h9wbdaW7PlnyM2Xoh-br7d9zaY5r4UDA",
  );
  assert.deepEqual(rotationSigningInput(old), new Uint8Array([...utf8("nmts/p1/rotate/v1\n"), ...fromBase64Url(old)]));
  assert.ok(signatureHolds(businessPublicKey(next), rotationSigningInput(old), proof));
  const other = businessPublicKey(toBase64Url(new Uint8Array(32).fill(5)));
  assert.ok(!signatureHolds(businessPublicKey(next), rotationSigningInput(other), proof));
});

test("⛔ a refusal about a key never carries the key", () => {
  const secret = toBase64Url(new Uint8Array(31).fill(4));
  assert.throws(
    () => signBusinessRequest({ accountId: BUSINESS, privateKey: secret, method: "GET", path: "/p1/business" }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.ok(!error.message.includes(secret), "the refusal echoed the private key");
      assert.match(error.message, /31 bytes/);
      return true;
    },
  );
});

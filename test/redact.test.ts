// What is taken out of a text, and — just as hard — what is left in it.
//
// ⛔ BOTH DIRECTIONS, RULE BY RULE. A redactor that replaces everything passes every test that
//    only asks "is the secret gone", and it makes the reports it protects useless: a file name, a
//    folder, an address and the sentence the server refused with are the whole content of most
//    reports. So every rule has a text it must replace, and every protected thing has a text it
//    must leave exactly as it was.
//
// ⛔ THE ENVIRONMENT IS CLEARED FIRST. One rule reads `NMTS_*` out of this process, so a variable
//    the runner happened to be started with would change what the other tests measure — and it
//    would do it differently on somebody else's machine.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { omitLiterals, redact, RULES, SHORTEST_OMIT } from "../src/redact.ts";

const held = new Map<string, string>();
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("NMTS_") && value !== undefined) {
    held.set(name, value);
    delete process.env[name];
  }
}
after(() => {
  for (const [name, value] of held) process.env[name] = value;
});

/** 32 data symbols and a check symbol. Not a real account — the shape is what is recognised. */
const CODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ0";
const CODE_GROUPED = "0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ0";
const CODE_SPACED = "0123 4567 89AB CDEF GHJK MNPQ RSTV WXYZ0";
/** The API key's exact shape, built the way `fake-drive.ts` builds one. */
const KEY = `nmts_ak1_Abcdefghijkl_${"x".repeat(43)}`;
/** A public code: three groups of nine, twenty-seven symbols. It is meant to travel. */
const PUBLIC_CODE = "A7QK2M9PW-RSTV0123X-456789ABC";

// ── One text each rule must replace ────────────────────────────────────────────────────────────

test("the account code goes, run together, hyphenated or spaced", () => {
  assert.equal(redact(`my code is ${CODE} and it failed`), "my code is [account-code] and it failed");
  assert.equal(redact(`pasted ${CODE_GROUPED}.`), "pasted [account-code].");
  assert.equal(redact(`pasted ${CODE_SPACED}.`), "pasted [account-code].");
  // ⛔ And after an `=`, which is where a code reaches a command line by mistake.
  assert.equal(redact(`--message=${CODE}`), "--message=[account-code]");
});

test("the API key goes, and is named as a key rather than as key material", () => {
  assert.equal(redact(`sent ${KEY} and got 401`), "sent [api-key] and got 401");
});

test("a value this process is holding goes, named by the variable it came from", () => {
  process.env["NMTS_PASSPHRASE"] = "correct horse battery";
  try {
    assert.equal(redact("I typed correct horse battery"), "I typed [env:NMTS_PASSPHRASE]");
  } finally {
    delete process.env["NMTS_PASSPHRASE"];
  }
});

test("⛔ the environment wins over the shape, so the label says where the value came from", () => {
  // The design decision this pins: a value the process is holding is KNOWN to be a secret, and
  // naming the variable tells whoever reads the report more than the shape-based label would.
  process.env["NMTS_ACCOUNT_CODE"] = CODE;
  try {
    assert.equal(redact(`code ${CODE}`), "code [env:NMTS_ACCOUNT_CODE]");
  } finally {
    delete process.env["NMTS_ACCOUNT_CODE"];
  }
});

test("a variable too short to be a credential is left alone", () => {
  process.env["NMTS_NETWORK"] = "testnet";
  try {
    assert.equal(redact("on testnet it works"), "on testnet it works");
  } finally {
    delete process.env["NMTS_NETWORK"];
  }
});

test("a bearer token and a key in a query string go, and the name stays", () => {
  assert.equal(redact("Authorization: Bearer abc.def.ghi"), "Authorization: Bearer [secret]");
  assert.equal(
    redact("https://nmts.me/v1/x?api_key=Ie7Qm2Zx9&z=1"),
    "https://nmts.me/v1/x?api_key=[secret]&z=1",
  );
  assert.equal(redact("token=abcdefgh12345678"), "token=[secret]");
});

test("a long run of key material goes, base64url or hex", () => {
  assert.equal(redact(`ct ${"Ab3-_x".repeat(8)} end`), "ct [secret] end");
  assert.equal(redact(`hash ${"3a7f9c1e2b4d5a6f8e0c1d2b3a4f5e6c7d8b9a0f1e2d3c4b5a6f7e8d9c"} end`), "hash [secret] end");
});

test("a private key goes whole, header to footer, and a lone header goes too", () => {
  assert.equal(
    redact("-----BEGIN PRIVATE KEY-----\nMIIBVgIBADAN\nAQEA\n-----END PRIVATE KEY-----"), // nmts-secret-scan: allow a twelve-byte fixture, not a key
    "[secret]",
  );
  assert.equal(redact("it printed -----BEGIN OPENSSH PRIVATE KEY-----"), "it printed [secret]"); // nmts-secret-scan: allow header only, no key
  assert.equal(redact("key suiprivkey1qql8mhx7 here"), "key [secret] here");
});

test("a twelve-word and a twenty-four-word phrase go", () => {
  const twelve = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  assert.equal(redact(twelve), "[words]");
  assert.equal(redact(`${twelve} ${twelve}`), "[words]");
});

// ── One text each protected thing must survive ─────────────────────────────────────────────────

const KEPT: [string, string][] = [
  ["a public code", `send it to ${PUBLIC_CODE}`],
  ["a file name", "photos/screenshot-2026-09-04-at-14-32-11-the-upload-dialog.png"],
  ["a folder path", "/srv/work/nmts drafts/2026"],
  ["an address on the site", "https://nmts.me/updates/0.26.0"],
  [
    "an error sentence",
    "The bytes went out but the storage was never certified, so the file is not safely stored.",
  ],
  ["an HTTP status", "it answered 429 and then 409 VERSION_CONFLICT"],
  ["a command name", "nmts support send --category bug --sub upload --attach-log 3"],
  ["a long ordinary word", "pneumonoultramicroscopicsilicovolcanoconio"],
  ["an ordinary sentence of short words", "the quick brown fox jumps over the lazy dog and then some more here"],
];

for (const [what, text] of KEPT) {
  test(`${what} travels unchanged`, () => {
    assert.equal(redact(text), text);
  });
}

// ── The rules as data, and the values a caller names ───────────────────────────────────────────

test("every rule is a label and a global pattern, so the list can be walked", () => {
  assert.ok(RULES.length >= 8, `only ${RULES.length} rules — the walk is blind`);
  for (const rule of RULES) {
    assert.match(rule.label, /^\[[a-z:-]+\]$/, `${rule.label} is not a label`);
    assert.ok(rule.test.global, `${rule.label} would replace only the first match`);
  }
});

test("--omit replaces every occurrence, and refuses a value too short to mean one thing", () => {
  assert.equal(omitLiterals("in drafts/a and drafts/b", ["drafts"]), "in [omitted]/a and [omitted]/b");
  // A dot is a dot, not "any character": the value is literal.
  assert.equal(omitLiterals("a.b and axb", ["a.b"]), "[omitted] and axb");
  // Below the floor it does nothing here; the command refuses it before this is reached.
  assert.equal(omitLiterals("about", ["ab".slice(0, SHORTEST_OMIT - 1)]), "about");
});

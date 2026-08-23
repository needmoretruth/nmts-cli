// The defect this file was written for: the first version cleared the buffer in the same branch
// that read it, so every secret came back as a run of NUL bytes. That is test one.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { SecretReader } from "../src/secret-reader.ts";

const bytes = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "utf8"));
const ENTER = new Uint8Array([0x0d]);

test("the value survives being read — it is not wiped before it is returned", () => {
  const r = new SecretReader();
  r.push(bytes("CODE1234"));
  const step = r.push(ENTER);
  assert.equal(step.kind, "done");
  assert.equal(step.kind === "done" ? step.value : null, "CODE1234");
});

test("the buffer is empty once the value has been taken", () => {
  const r = new SecretReader();
  r.push(bytes("CODE1234"));
  r.push(ENTER);
  assert.equal(r.length, 0);
});

test("bytes typed across several chunks make one value", () => {
  const r = new SecretReader();
  r.push(bytes("CO"));
  r.push(bytes("DE"));
  const step = r.push(bytes("12\r"));
  assert.equal(step.kind === "done" ? step.value : null, "CODE12");
});

test("backspace removes the previous byte", () => {
  const r = new SecretReader();
  r.push(bytes("CODEX"));
  r.push(new Uint8Array([0x7f]));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "CODE");
});

test("backspace on an empty buffer does not go negative", () => {
  const r = new SecretReader();
  r.push(new Uint8Array([0x7f, 0x7f, 0x7f]));
  r.push(bytes("A"));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "A");
});

test("Ctrl-C cancels no matter how much has been typed", () => {
  const r = new SecretReader();
  r.push(bytes("CODE"));
  assert.equal(r.push(new Uint8Array([0x03])).kind, "cancelled");
});

test("Ctrl-D cancels only on an empty buffer — otherwise it is not a keystroke in a secret", () => {
  const empty = new SecretReader();
  assert.equal(empty.push(new Uint8Array([0x04])).kind, "cancelled");

  const typed = new SecretReader();
  typed.push(bytes("CODE"));
  assert.equal(typed.push(new Uint8Array([0x04])).kind, "more");
  assert.equal(typed.push(ENTER).kind === "done", true);
});

test("an arrow key does not become part of the secret — the WHOLE sequence goes", () => {
  const r = new SecretReader();
  r.push(bytes("CO"));
  r.push(new Uint8Array([0x1b, 0x5b, 0x41])); // ESC [ A — up arrow
  r.push(bytes("DE"));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "CODE");
});

test("an escape sequence split across chunks is still swallowed whole", () => {
  const r = new SecretReader();
  r.push(bytes("CO"));
  r.push(new Uint8Array([0x1b]));
  r.push(new Uint8Array([0x5b]));
  r.push(new Uint8Array([0x41]));
  r.push(bytes("DE"));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "CODE");
});

test("a CSI sequence with parameters (Home, F5) is swallowed whole", () => {
  const r = new SecretReader();
  r.push(bytes("A"));
  r.push(new Uint8Array([0x1b, 0x5b, 0x31, 0x35, 0x7e])); // ESC [ 1 5 ~ — F5
  r.push(bytes("B"));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "AB");
});

test("a two-byte escape (ESC then a letter) eats only those two bytes", () => {
  const r = new SecretReader();
  r.push(bytes("A"));
  r.push(new Uint8Array([0x1b, 0x4f])); // ESC O
  r.push(bytes("B"));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "AB");
});

test("line feed ends the value as well as carriage return", () => {
  const r = new SecretReader();
  r.push(bytes("CODE"));
  assert.equal(r.push(new Uint8Array([0x0a])).kind, "done");
});

test("surrounding spaces from a paste are removed", () => {
  const r = new SecretReader();
  r.push(bytes("  CODE1234  "));
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "CODE1234");
});

test("wipe clears without returning anything", () => {
  const r = new SecretReader();
  r.push(bytes("CODE"));
  r.wipe();
  assert.equal(r.length, 0);
  const step = r.push(ENTER);
  assert.equal(step.kind === "done" ? step.value : null, "");
});

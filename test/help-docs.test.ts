// `nmts help <command>` prints the command's own document; an unknown name lists what there is.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { helpFor } from "../src/help.ts";

test("a command name finds its document, whichever document covers it", async () => {
  const put = await helpFor("put");
  assert.equal(put.found, true);
  assert.match(put.text, /^# nmts put: /);
  const restore = await helpFor("restore");
  assert.equal(restore.found, true);
  assert.match(restore.text, /^# nmts rm, restore, sweep/);
});

test("an unknown name is not found, and the answer lists every name that is", async () => {
  const none = await helpFor("frobnicate");
  assert.equal(none.found, false);
  assert.match(none.text, /No document for "frobnicate"/);
  assert.match(none.text, /\bput\b/);
  assert.match(none.text, /\bdelete-account\b/);
});

test("`<command> --help` prints that command's document, not the whole list", async () => {
  const { printHelp } = await import("../src/help.ts");
  let out = "";
  const code = await printHelp({ command: "put", operands: [] }, (t) => { out += t; });
  assert.equal(code, 0);
  assert.match(out, /^# nmts put: /);
  out = "";
  await printHelp({ command: null, operands: [] }, (t) => { out += t; });
  assert.match(out, /^nmts .*: command-line access/m, "a bare run still prints the whole list");
});

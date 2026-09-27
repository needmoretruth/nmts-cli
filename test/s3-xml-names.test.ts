// Names that are not what they seem: an entity or an extension spelled like something every
// JavaScript object inherits, and a file name with a character XML 1.0 cannot carry.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { contentTypeOf, UNKNOWN_TYPE } from "../src/s3/content-type.ts";
import { deleteAskOf, parseXml } from "../src/s3/xml-read.ts";
import { errorXml, escapeXml, listObjectsXml, type ObjectRow } from "../src/s3/xml.ts";
import { S3Refusal } from "../src/s3/answer.ts";

const INHERITED = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];

test("⛔ an entity named like an inherited property is an unknown entity, not the property", () => {
  for (const name of INHERITED) {
    const xml = `<Delete><Object><Key>&${name};</Key></Object></Delete>`;
    assert.throws(
      () => deleteAskOf(parseXml(xml)),
      (error: unknown) => error instanceof S3Refusal && error.code === "MalformedXML",
      name,
    );
  }
  assert.deepEqual(deleteAskOf(parseXml("<Delete><Object><Key>a&amp;b&lt;&apos;</Key></Object></Delete>")).objects, [
    { key: "a&b<'", versionId: null },
  ]);
});

test("⛔ an extension named like an inherited property is an unknown type", () => {
  for (const name of INHERITED) assert.equal(contentTypeOf(`a.${name}`), UNKNOWN_TYPE, name);
  assert.equal(contentTypeOf("a.html"), "text/html; charset=utf-8");
});

/** Characters XML 1.0 forbids outright, raw or as a reference. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|&#x0*(?:[0-8bcefBCEF]|1[0-9a-fA-F]);|&#0*(?:[0-8]|1[124-9]|2[0-9]|3[01]);/u;

function row(key: string): ObjectRow {
  return { key, lastModified: "2026-09-24T00:00:00.000Z", etag: '"e"', size: 1 };
}

function listing(keys: readonly string[], encodingType: string | null): string {
  return listObjectsXml({
    bucket: "drive",
    prefix: "",
    delimiter: "",
    maxKeys: 1000,
    v2: true,
    contents: keys.map(row),
    commonPrefixes: [],
    truncated: false,
    next: null,
    encodingType,
  });
}

const CONTROL = String.fromCharCode(1);
const ESCAPE = String.fromCharCode(0x1b);
const LONE = String.fromCharCode(0xd800);

test("⛔ a listing with control characters in its names is still a document XML 1.0 can carry", () => {
  const keys = [`bell${CONTROL}.txt`, `esc${ESCAPE}[0m.txt`, `half${LONE}.txt`, "fine.txt"];
  const xml = listing(keys, null);
  assert.doesNotMatch(xml, FORBIDDEN);
  assert.doesNotMatch(xml, /\p{Cs}/u);
  // Each such character is shown as U+FFFD, and every other name is untouched.
  const read = parseXml(xml.slice(xml.indexOf("<ListBucketResult")));
  const names = read.children.filter((c) => c.name === "Contents").map((c) => c.children.find((k) => k.name === "Key")?.text);
  assert.deepEqual(names, ["bell\uFFFD.txt", "esc\uFFFD[0m.txt", "half\uFFFD.txt", "fine.txt"]);
});

test("encoding-type=url hands the exact name back, control characters included", () => {
  const xml = listing([`bell${CONTROL}.txt`, `half${LONE}.txt`], "url");
  assert.doesNotMatch(xml, FORBIDDEN);
  assert.match(xml, /<Key>bell%01.txt<\/Key>/);
  // Half a surrogate pair has no UTF-8 to percent-encode; it does not throw.
  assert.match(xml, /<Key>half%EF%BF%BD.txt<\/Key>/);
});

test("⚠ a carriage return in a name survives parsing, which a raw one does not", () => {
  const xml = listing(["a\rb.txt"], null);
  assert.match(xml, /<Key>a&#xD;b.txt<\/Key>/);
  const read = parseXml(xml.slice(xml.indexOf("<ListBucketResult")));
  const key = read.children.find((c) => c.name === "Contents")?.children.find((k) => k.name === "Key")?.text;
  assert.equal(key, "a\rb.txt");
});

test("an error document quoting a name with a control character is still XML 1.0", () => {
  const xml = errorXml("InvalidRequest", `the key "x${CONTROL}y" holds another file`, "/drive/x%01y");
  assert.doesNotMatch(xml, FORBIDDEN);
  assert.equal(escapeXml(`<&>"'${CONTROL}`), "&lt;&amp;&gt;&quot;&apos;\uFFFD");
});

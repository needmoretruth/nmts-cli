// `DeleteObjects`, and the small XML reader it and the multipart finish depend on.
//
// ⛔ `aws s3 rm --recursive` AND `rclone sync` DELETE IN BATCHES. A gateway without this answered
//    501 to the first batch, and the tool either stopped or deleted nothing while saying it had.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { after, test } from "node:test";

import { S3Refusal } from "../src/s3/answer.ts";
import { checksumOf } from "../src/s3/checksum.ts";
import { createGateway } from "../src/s3/server.ts";
import { completeAskOf, deleteAskOf, parseXml } from "../src/s3/xml-read.ts";
import { CREDENTIAL, fakeDrive, listening, readOnly, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const drive = await fakeDrive();
await drive.seed("a.txt", "a");
await drive.seed("dir/b & c.txt", "b");
await drive.seed("dir/<d>.txt", "d");
const source = drive.source();
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? source : name === "ro" ? readOnly : null),
});
const HOST = await listening(gateway);
after(() => gateway.close());

/** The `Content-MD5` S3 requires on a batch delete. */
const md5Of = (body: Buffer): string => createHash("md5").update(body).digest("base64");

const remove = (xml: string, bucket = "b", host = HOST): Promise<Response> =>
  send(host, "POST", `/${bucket}?delete`, {
    body: Buffer.from(xml),
    headers: { "content-type": "application/xml", "content-md5": md5Of(Buffer.from(xml)) },
  });

test("each key is sent to the trash and answered Deleted; a key that is not there counts as deleted", async () => {
  const res = await remove(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Object><Key>a.txt</Key></Object><Object><Key>dir/b &amp; c.txt</Key></Object>` +
      `<Object><Key>never-there.txt</Key></Object></Delete>`,
  );
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.deepEqual(values(body, "Key"), ["a.txt", "dir/b & c.txt", "never-there.txt"]);
  assert.deepEqual(drive.trashed, ["/a.txt", "/dir/b & c.txt"]);
  assert.doesNotMatch(body, /<Error>/);
});

test("quiet mode answers only the failures, and a prefixed namespace and character references still read", async () => {
  const res = await remove(
    `<s3:Delete xmlns:s3="http://s3.amazonaws.com/doc/2006-03-01/"><s3:Quiet>true</s3:Quiet>` +
      `<s3:Object><s3:Key>dir/&#60;d&#x3E;.txt</s3:Key></s3:Object>` +
      `<s3:Object><s3:Key>a.txt</s3:Key><s3:VersionId>v2</s3:VersionId></s3:Object></s3:Delete>`,
  );
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /<Deleted>/, "quiet mode listed what it deleted");
  assert.equal(drive.trashed.at(-1), "/dir/<d>.txt");
  assert.deepEqual(values(body, "Key"), ["a.txt"]);
  assert.deepEqual(values(body, "Code"), ["NotImplemented"], "a version was deleted from a drive that keeps none");
});

test("one key's failure is that key's Error row, and the others are still deleted", async () => {
  await drive.seed("fails.txt", "f");
  await drive.seed("works.txt", "w");
  drive.failTrashOf("/fails.txt", Object.assign(new Error("slow down"), { code: "RATE_LIMITED" }));
  const res = await remove("<Delete><Object><Key>fails.txt</Key></Object><Object><Key>works.txt</Key></Object></Delete>");
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(values(body, "Code"), ["SlowDown"]);
  assert.match(body, /<Deleted><Key>works\.txt<\/Key><\/Deleted>/);
  assert.equal(drive.textAt("works.txt"), undefined, "the key that could go did not");
  assert.equal(drive.textAt("fails.txt"), "f");
});

test("⛔ a batch is one write to the file list, not one per key", async () => {
  for (const name of ["one", "two", "three"]) await drive.seed(`batch/${name}.txt`, name);
  const before = drive.listWrites.count;
  const res = await remove(
    "<Delete><Object><Key>batch/one.txt</Key></Object><Object><Key>batch/two.txt</Key></Object>" +
      "<Object><Key>batch/three.txt</Key></Object></Delete>",
  );
  assert.equal(res.status, 200);
  assert.equal(values(await res.text(), "Key").length, 3);
  assert.equal(drive.listWrites.count - before, 1, "each key was its own write");
});

// ⛔ SIGNED AS UNSIGNED-PAYLOAD, NOTHING ELSE BINDS THE KEY LIST TO THE SIGNATURE: S3 requires a digest.
test("⛔ a batch with no Content-MD5 or checksum is refused, and one whose digest is wrong deletes nothing", async () => {
  await drive.seed("guarded.txt", "g");
  const xml = "<Delete><Object><Key>guarded.txt</Key></Object></Delete>";
  const bare = await send(HOST, "POST", "/b?delete", { body: Buffer.from(xml) });
  assert.equal(bare.status, 400);
  assert.match(await bare.text(), /Content-MD5/);
  const wrong = await send(HOST, "POST", "/b?delete", {
    body: Buffer.from(xml),
    headers: { "content-md5": md5Of(Buffer.from("<Delete><Object><Key>other</Key></Object></Delete>")) },
  });
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /<Code>BadDigest<\/Code>/);
  assert.equal(drive.textAt("guarded.txt"), "g");
  // An x-amz-checksum-* header is the other way S3 accepts.
  const summed = await send(HOST, "POST", "/b?delete", {
    body: Buffer.from(xml),
    headers: { "x-amz-checksum-crc32": checksumOf("crc32", Buffer.from(xml)) },
  });
  assert.equal(summed.status, 200);
  assert.equal(drive.textAt("guarded.txt"), undefined);
});

test("⛔ a key already in the trash is answered deleted — by one DELETE and in a batch", async () => {
  await drive.seed("twice.txt", "t");
  // A list cached before the first delete still names it; the second must not fail on that.
  const cached = drive.source({ listCacheMs: 60_000 });
  const other = createGateway({ credentials: [CREDENTIAL], bucketOf: () => cached });
  const host = await listening(other);
  try {
    assert.equal((await send(host, "GET", "/b?list-type=2")).status, 200);
    assert.equal((await send(HOST, "DELETE", "/b/twice.txt")).status, 204);
    assert.equal((await send(host, "DELETE", "/b/twice.txt")).status, 204);
    const batch = await remove("<Delete><Object><Key>twice.txt</Key></Object></Delete>", "b", host);
    assert.equal(batch.status, 200);
    assert.doesNotMatch(await batch.text(), /<Error>/);
  } finally {
    other.close();
  }
});

test("⛔ a condition on one key of a batch is refused, and nothing is deleted", async () => {
  await drive.seed("conditional.txt", "c");
  const res = await remove("<Delete><Object><Key>conditional.txt</Key><ETag>\"abc\"</ETag></Object></Delete>");
  assert.equal(res.status, 501);
  assert.equal(drive.textAt("conditional.txt"), "c");
});

test("⛔ deleting a folder marker leaves the files under it where they are", async () => {
  await drive.seed("kept/inside.txt", "i");
  assert.equal((await send(HOST, "DELETE", "/b/kept/")).status, 204);
  assert.equal(drive.textAt("kept/inside.txt"), "i", "deleting the marker trashed the folder's files");
  await send(HOST, "DELETE", "/b/kept/inside.txt");
  assert.equal((await send(HOST, "DELETE", "/b/kept/")).status, 204);
  assert.equal((await send(HOST, "HEAD", "/b/kept/")).status, 404, "an empty folder's marker did not go");
});

test("⛔ more than a thousand keys, no keys, or a body that is not the document is MalformedXML", async () => {
  const many = `<Delete>${"<Object><Key>k</Key></Object>".repeat(1001)}</Delete>`;
  for (const xml of [many, "<Delete></Delete>", "<Delete><Object><Key>a</Key></Object>", "not xml", "<Other/>"]) {
    const res = await remove(xml);
    assert.equal(res.status, 400, xml.slice(0, 40));
    assert.match(await res.text(), /<Code>MalformedXML<\/Code>/);
  }
});

test("⛔ a body over a mebibyte is refused before it is read", async () => {
  // Only the headers go out. The refusal comes from the declared length and closes the connection;
  // with the body also on its way, macOS resets the socket first and fetch reports "fetch failed".
  const body = Buffer.from(`<Delete>${" ".repeat(1024 * 1024)}<Object><Key>a</Key></Object></Delete>`);
  const signed = sign("POST", "/b?delete", HOST, CREDENTIAL, new Date(), body);
  const url = new URL(signed.url);
  const answer = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: Number(url.port),
        method: "POST",
        path: url.pathname + url.search,
        headers: {
          ...signed.headers,
          "content-type": "application/xml",
          "content-md5": md5Of(body),
          "content-length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          req.destroy();
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() });
        });
      },
    );
    req.on("error", reject);
    req.flushHeaders();
  });
  assert.equal(answer.status, 400);
  assert.match(answer.text, /larger than/);
});

test("⛔ a read-only drive refuses the batch with its sentence", async () => {
  const res = await remove("<Delete><Object><Key>readme.txt</Key></Object></Delete>", "ro");
  assert.equal(res.status, 501);
  assert.match(await res.text(), /consent grant spend/);
});

test("⛔ the XML reader refuses what declares things, and what does not close", () => {
  const refused = (xml: string): void => {
    assert.throws(() => parseXml(xml), (error: unknown) => error instanceof S3Refusal && error.code === "MalformedXML", xml);
  };
  refused(`<!DOCTYPE d [<!ENTITY x "y">]><Delete/>`);
  refused("<Delete><Object></Delete>");
  refused("<a/><b/>");
  refused("<a>&unknown;</a>");
  refused("<a>&#0;</a>");
  refused("<a b=unquoted/>");
  refused(`${"<a>".repeat(40)}${"</a>".repeat(40)}`);
});

test("the XML reader reads text, CDATA, comments and line ends the way XML says", () => {
  const root = parseXml(
    `﻿<?xml version="1.0"?><!-- a note --><Delete a='1' b="2"><Object><Key><![CDATA[x<y>&z]]></Key>` +
      `</Object><Object><Key>line\r\nend</Key></Object></Delete>`,
  );
  assert.deepEqual(
    deleteAskOf(root).objects.map((o) => o.key),
    ["x<y>&z", "line\nend"],
  );
  const parts = completeAskOf(
    parseXml(`<CompleteMultipartUpload><Part><ETag>"e1"</ETag><PartNumber> 1 </PartNumber></Part></CompleteMultipartUpload>`),
  );
  assert.deepEqual(parts, [{ partNumber: 1, etag: '"e1"' }]);
});

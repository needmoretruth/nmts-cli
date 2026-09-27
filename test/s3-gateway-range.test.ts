// A GET for part of a file, or only if it changed — and the type a file is answered with.
//
// ⛔ A RANGE IS EXACTLY THOSE BYTES, OR THE WHOLE FILE, OR 416. Download managers, video players and
//    `rclone mount` read files in windows; a gateway that answered every range with the whole file
//    made each window cost the file, and one that answered it wrong made a file that opens and is
//    wrong.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { contentTypeOf } from "../src/s3/content-type.ts";
import { rangeOf } from "../src/s3/range.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, FETCH_RUN, listening, send } from "./s3-gateway-drive.ts";

const TEXT = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36 bytes, read in runs of four
const drive = await fakeDrive();
await drive.seed("letters.txt", TEXT);
await drive.seed("page.html", "<p>hi</p>");
await drive.seed("empty.bin", "");
const source = drive.source();
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: (name) => (name === "b" ? source : null) });
const HOST = await listening(gateway);
after(() => gateway.close());

const get = (key: string, headers: Record<string, string> = {}): Promise<Response> =>
  send(HOST, "GET", `/b/${key}`, { headers });

test("one range is 206 with exactly those bytes and where they sit", async () => {
  const res = await get("letters.txt", { range: "bytes=5-14" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 5-14/${TEXT.length}`);
  assert.equal(res.headers.get("content-length"), "10");
  assert.equal(await res.text(), TEXT.slice(5, 15));
});

test("an open range runs to the end, and a suffix range is the last n bytes", async () => {
  const open = await get("letters.txt", { range: "bytes=30-" });
  assert.equal(open.status, 206);
  assert.equal(await open.text(), TEXT.slice(30));
  const tail = await get("letters.txt", { range: "bytes=-3" });
  assert.equal(tail.headers.get("content-range"), `bytes 33-35/${TEXT.length}`);
  assert.equal(await tail.text(), "xyz");
  const more = await get("letters.txt", { range: "bytes=-100" });
  assert.equal(await more.text(), TEXT, "a suffix longer than the file is the whole file");
  const past = await get("letters.txt", { range: "bytes=20-999" });
  assert.equal(await past.text(), TEXT.slice(20), "an end past the file is the file's end");
});

test("⛔ a range that starts past the end is 416 with the size, so the client can ask again", async () => {
  const res = await get("letters.txt", { range: "bytes=36-40" });
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), `bytes */${TEXT.length}`);
  assert.match(await res.text(), /<Code>InvalidRange<\/Code>/);
  assert.equal((await get("empty.bin", { range: "bytes=0-" })).status, 416);
});

test("several ranges, or a range written wrong, are the whole file with 200", async () => {
  for (const range of ["bytes=0-1,4-5", "bytes=9-3", "items=0-3", "bytes=abc"]) {
    const res = await get("letters.txt", { range });
    assert.equal(res.status, 200, range);
    assert.equal(await res.text(), TEXT, range);
  }
});

test("⭐ the reader stops once the range is out, rather than fetching the rest for nobody", async () => {
  const before = drive.delivered.writes;
  const res = await get("letters.txt", { range: "bytes=0-5" });
  assert.equal(await res.text(), TEXT.slice(0, 6));
  assert.equal(drive.delivered.writes - before, Math.ceil(6 / FETCH_RUN), "the whole file was read for six bytes");
});

test("HEAD and GET say ranges are accepted, and HEAD answers a range's length", async () => {
  const head = await send(HOST, "HEAD", "/b/letters.txt");
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.equal((await get("letters.txt")).headers.get("accept-ranges"), "bytes");
  const ranged = await send(HOST, "HEAD", "/b/letters.txt", { headers: { range: "bytes=2-3" } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("content-length"), "2");
});

test("If-None-Match and If-Modified-Since answer 304 for a file that has not changed", async () => {
  const head = await send(HOST, "HEAD", "/b/letters.txt");
  const etag = head.headers.get("etag") ?? "";
  const modified = head.headers.get("last-modified") ?? "";
  const same = await get("letters.txt", { "if-none-match": etag });
  assert.equal(same.status, 304);
  assert.equal(same.headers.get("etag"), etag);
  assert.equal((await get("letters.txt", { "if-none-match": '"other-1"' })).status, 200);
  assert.equal((await get("letters.txt", { "if-modified-since": modified })).status, 304);
  const earlier = new Date(Date.parse(modified) - 60_000).toUTCString();
  assert.equal((await get("letters.txt", { "if-modified-since": earlier })).status, 200);
});

test("If-Match and If-Unmodified-Since answer 412 for a file that has changed", async () => {
  const head = await send(HOST, "HEAD", "/b/letters.txt");
  const etag = head.headers.get("etag") ?? "";
  const modified = Date.parse(head.headers.get("last-modified") ?? "");
  const wrong = await get("letters.txt", { "if-match": '"other-1"' });
  assert.equal(wrong.status, 412);
  assert.match(await wrong.text(), /<Code>PreconditionFailed<\/Code>/);
  assert.equal((await get("letters.txt", { "if-match": etag })).status, 200);
  assert.equal((await get("letters.txt", { "if-match": "*" })).status, 200);
  const before = new Date(modified - 60_000).toUTCString();
  assert.equal((await send(HOST, "HEAD", "/b/letters.txt", { headers: { "if-unmodified-since": before } })).status, 412);
  // If-Match that holds wins over If-Unmodified-Since that does not — S3's rule.
  assert.equal((await get("letters.txt", { "if-match": etag, "if-unmodified-since": before })).status, 200);
});

test("the type a file is answered with is guessed from its extension", async () => {
  assert.equal((await get("page.html")).headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal((await send(HOST, "HEAD", "/b/letters.txt")).headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal((await get("empty.bin")).headers.get("content-type"), "application/octet-stream");
  assert.equal(contentTypeOf("photos/A.JPG"), "image/jpeg");
  assert.equal(contentTypeOf("fonts/x.woff2"), "font/woff2");
  assert.equal(contentTypeOf("archive.tar.gz"), "application/gzip");
  assert.equal(contentTypeOf(".hidden"), "application/octet-stream");
  assert.equal(contentTypeOf("dir.v2/README"), "application/octet-stream");
});

test("the range reader agrees with the rules on its own", () => {
  assert.deepEqual(rangeOf("bytes=0-0", 1), { kind: "window", start: 0, end: 0 });
  assert.deepEqual(rangeOf("bytes=-0", 10), { kind: "unsatisfiable" });
  assert.deepEqual(rangeOf("bytes=-", 10), { kind: "whole" });
  assert.deepEqual(rangeOf(undefined, 10), { kind: "whole" });
  assert.deepEqual(rangeOf(" Bytes = 2 - 4 ", 10), { kind: "window", start: 2, end: 4 });
});

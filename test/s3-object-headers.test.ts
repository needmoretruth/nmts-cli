// What a browser is allowed to do with a file the gateway serves, and how a link makes it download.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, raw, send } from "./s3-gateway-drive.ts";
import { presign } from "./s3-sign.ts";

const PAGE = "<html><script>document.cookie</script></html>";

const drive = await fakeDrive();
await drive.seed("page.html", PAGE);
const source = drive.source();
const gateway = createGateway({ credentials: [CREDENTIAL], bucketOf: (name) => (name === "drive" ? source : null) });
const HOST = await listening(gateway);
after(() => gateway.close());

test("⛔ a file a browser would run is sandboxed and never sniffed, on GET and on HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const res = await send(HOST, method, "/drive/page.html");
    await res.text();
    assert.equal(res.status, 200, method);
    assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8", method);
    assert.equal(res.headers.get("content-security-policy"), "sandbox", method);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", method);
  }
  const part = await send(HOST, "GET", "/drive/page.html", { headers: { range: "bytes=0-5" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-security-policy"), "sandbox");
});

test("⛔ a presigned link chooses the type and the disposition it is answered with", async () => {
  const url = presign("GET", "/drive/page.html", HOST, CREDENTIAL, new Date(), 60, {
    "response-content-type": "application/octet-stream",
    "response-content-disposition": 'attachment; filename="page.html"',
  });
  const res = await raw(HOST, "GET", url.target, { host: HOST });
  assert.equal(res.status, 200, res.body);
  assert.equal(res.headers["content-type"], "application/octet-stream");
  assert.equal(res.headers["content-disposition"], 'attachment; filename="page.html"');
  assert.equal(res.headers["content-security-policy"], "sandbox");
  assert.equal(res.body, PAGE);

  const head = presign("HEAD", "/drive/page.html", HOST, CREDENTIAL, new Date(), 60, { "response-content-disposition": "attachment" });
  const headed = await raw(HOST, "HEAD", head.target, { host: HOST });
  assert.equal(headed.headers["content-disposition"], "attachment");
});

test("the same parameters work on a header-signed request, which is signed too", async () => {
  const res = await send(HOST, "GET", "/drive/page.html?response-content-disposition=inline");
  await res.text();
  assert.equal(res.headers.get("content-disposition"), "inline");
});

test("⛔ a response-* value no header can carry is refused, not written or thrown", async () => {
  const url = presign("GET", "/drive/page.html", HOST, CREDENTIAL, new Date(), 60, {
    "response-content-disposition": "attachment\r\nset-cookie: a=b",
  });
  const res = await raw(HOST, "GET", url.target, { host: HOST });
  assert.equal(res.status, 400);
  assert.match(res.body, /<Code>InvalidArgument<\/Code>/);
  assert.equal(res.headers["set-cookie"], undefined);
});

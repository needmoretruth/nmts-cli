// `CompleteMultipartUpload` and `CopyObject` answering while the file is stored: 200 as soon as the
// request has been checked, a space while the store runs, then the result -- or an error document
// -- in that same body, in the shape the AWS SDK for JavaScript v3 reads.
//
// ⛔ THE STORE IS HELD SHUT BY THE TEST. "The 200 came before the store finished" is then something
//    the test arranges rather than a race it hopes to win, and the keep-alive runs every 20 ms
//    instead of every 10 seconds so the spaces arrive while it waits.

import { strict as assert } from "node:assert";
import { request, type IncomingHttpHeaders } from "node:http";
import { after, test } from "node:test";

import type { DriveAccount } from "../src/s3/drive.ts";
import { createGateway } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening, send, values } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const DECLARATION = `<?xml version="1.0" encoding="UTF-8"?>`;

const drive = await fakeDrive();
await drive.seed("docs/report.pdf", "the report's bytes");

/** Shut: every store waits until the test opens it again. */
let gate: Promise<void> = Promise.resolve();
let open: () => void = () => undefined;
function shut(): void {
  gate = new Promise<void>((resolve) => {
    open = resolve;
  });
}

const slow: DriveAccount = {
  ...drive.account,
  store: async (local, name, folder, how) => {
    await gate;
    await drive.account.store(local, name, folder, how);
  },
};
const source = drive.source({ account: slow });
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? source : null),
  keepAliveMs: 20,
});
const HOST = await listening(gateway);
after(() => gateway.close());

/** An answer read as it arrives. */
interface Streamed {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** The body so far. */
  readonly sofar: () => string;
  /** The whole body, once the answer ends. */
  readonly body: Promise<string>;
}

/** One signed request, settled as soon as the status line and headers are in. */
function streamed(method: string, target: string, body: Buffer, extra: Record<string, string> = {}): Promise<Streamed> {
  const signed = sign(method, target, HOST, CREDENTIAL, new Date(), body, extra);
  const port = Number(HOST.slice(HOST.lastIndexOf(":") + 1));
  return new Promise<Streamed>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: target,
        headers: { ...signed.headers, "content-length": String(body.length), ...extra },
      },
      (res) => {
        const pieces: Buffer[] = [];
        const whole = new Promise<string>((done, fail) => {
          res.on("data", (chunk: Buffer) => pieces.push(chunk));
          res.on("end", () => done(Buffer.concat(pieces).toString()));
          res.on("error", fail);
        });
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          sofar: () => Buffer.concat(pieces).toString(),
          body: whole,
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** `promise`, or a failure naming `what` after five seconds -- a held store must not hang the run. */
async function within<T>(what: string, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`never: ${what}`)), 5_000);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(what: string, holds: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!holds()) {
    if (Date.now() > deadline) assert.fail(`never: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * What the AWS SDK for JavaScript v3 makes of a 200 to these two operations, as its
 * `throw200ExceptionsMiddleware` decides it: an empty body failed, and so did one whose last sixteen
 * bytes end in `</Error>`. Anything else goes to the operation's own parser.
 */
function sdkReadsAsFailure(body: string): boolean {
  const bytes = Buffer.from(body);
  return bytes.length === 0 || bytes.subarray(bytes.length - 16).toString().endsWith("</Error>");
}

/** The body split as the long answer writes it: declaration, the spaces, then one document. */
function shapeOf(body: string): { spaces: number; root: string; document: string } {
  assert.ok(body.startsWith(DECLARATION), `no XML declaration first: ${body.slice(0, 60)}`);
  const rest = body.slice(DECLARATION.length);
  const document = rest.trimStart();
  assert.match(rest.slice(0, rest.length - document.length), /^ *$/, "something other than spaces came before the document");
  return { spaces: rest.length - document.length, root: /^<([A-Za-z]+)[\s>]/.exec(document)?.[1] ?? "", document };
}

async function begin(key: string): Promise<{ id: string; list: Buffer }> {
  const begun = await send(HOST, "POST", `/b/${key}?uploads`);
  const id = values(await begun.text(), "UploadId")[0] ?? "";
  const part = await send(HOST, "PUT", `/b/${key}?partNumber=1&uploadId=${id}`, { body: Buffer.from(`the bytes of ${key}`) });
  assert.equal(part.status, 200);
  const etag = part.headers.get("etag") ?? "";
  const list = `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>${etag}</ETag></Part></CompleteMultipartUpload>`;
  return { id, list: Buffer.from(list) };
}

/** Send the request with the store shut, check the 200 and the spaces, open it, and read the rest. */
async function whileStoring(
  method: string,
  target: string,
  body: Buffer,
  storedAt: string,
  extra: Record<string, string> = {},
): Promise<{ answer: Streamed; text: string }> {
  shut();
  try {
    const answer = await within("an answer while the store is held shut", streamed(method, target, body, extra));
    assert.equal(answer.status, 200);
    assert.equal(answer.headers["content-type"], "application/xml");
    assert.match(String(answer.headers["x-amz-request-id"]), /^[0-9A-F]{16}$/);
    await until("two spaces after the declaration", () => answer.sofar().startsWith(`${DECLARATION}  `));
    assert.equal(drive.textAt(storedAt), undefined, "the answer waited for the store");
    open();
    return { answer, text: await answer.body };
  } finally {
    open();
  }
}

test("a finish answers 200 at once, keeps the connection alive, and ends with its result", async () => {
  const { id, list } = await begin("slow.bin");
  const { text } = await whileStoring("POST", `/b/slow.bin?uploadId=${id}`, list, "slow.bin");
  const shape = shapeOf(text);
  assert.ok(shape.spaces >= 2, `${shape.spaces} spaces`);
  assert.equal(shape.root, "CompleteMultipartUploadResult");
  assert.ok(shape.document.endsWith("</CompleteMultipartUploadResult>"));
  assert.equal(sdkReadsAsFailure(text), false);
  assert.equal(drive.textAt("slow.bin"), "the bytes of slow.bin");
  const head = await send(HOST, "HEAD", "/b/slow.bin");
  assert.deepEqual(values(text, "ETag"), [head.headers.get("etag") ?? ""]);
  assert.deepEqual(values(text, "Key"), ["slow.bin"]);
});

test("⛔ a finish whose store fails says so in the 200 body, as an error document the SDK reads as one", async () => {
  const { id, list } = await begin("fails.bin");
  drive.failNextStore(Object.assign(new Error("The storage network did not answer."), { status: 502 }));
  const { answer, text } = await whileStoring("POST", `/b/fails.bin?uploadId=${id}`, list, "fails.bin");
  const shape = shapeOf(text);
  assert.equal(shape.root, "Error");
  assert.ok(text.endsWith("</Error>"), "something follows </Error>, and the SDK would read success");
  assert.equal(sdkReadsAsFailure(text), true);
  assert.deepEqual(values(text, "Code"), ["SlowDown"]);
  // The failure's own words are for the log; the client reads the gateway's sentence.
  assert.doesNotMatch(values(text, "Message")[0] ?? "", /did not answer\./);
  assert.deepEqual(values(text, "RequestId"), [String(answer.headers["x-amz-request-id"])]);
  assert.equal(drive.textAt("fails.bin"), undefined);

  // The pieces stayed, so the same finish sent again stores the file.
  const again = await send(HOST, "POST", `/b/fails.bin?uploadId=${id}`, { body: list });
  assert.equal(again.status, 200);
  assert.equal(shapeOf(await again.text()).root, "CompleteMultipartUploadResult");
  assert.equal(drive.textAt("fails.bin"), "the bytes of fails.bin");
});

test("a copy answers 200 at once, keeps the connection alive, and ends with its result", async () => {
  const copied = await whileStoring("PUT", "/b/archive/report.pdf", Buffer.alloc(0), "archive/report.pdf", {
    "x-amz-copy-source": "b/docs/report.pdf",
  });
  const shape = shapeOf(copied.text);
  assert.ok(shape.spaces >= 2, `${shape.spaces} spaces`);
  assert.equal(shape.root, "CopyObjectResult");
  assert.equal(sdkReadsAsFailure(copied.text), false);
  assert.equal(drive.textAt("archive/report.pdf"), "the report's bytes");
  const head = await send(HOST, "HEAD", "/b/archive/report.pdf");
  assert.deepEqual(values(copied.text, "ETag"), [head.headers.get("etag") ?? ""]);
  assert.match(values(copied.text, "LastModified")[0] ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("⛔ a copy whose store fails says so in the 200 body, as an error document the SDK reads as one", async () => {
  drive.failNextStore(Object.assign(new Error("out of credits"), { code: "CREDITS_SHORT" }));
  const copied = await whileStoring("PUT", "/b/copy-fails.pdf", Buffer.alloc(0), "copy-fails.pdf", {
    "x-amz-copy-source": "b/docs/report.pdf",
  });
  assert.equal(shapeOf(copied.text).root, "Error");
  assert.ok(copied.text.endsWith("</Error>"));
  assert.equal(sdkReadsAsFailure(copied.text), true);
  assert.deepEqual(values(copied.text, "Code"), ["AccountProblem"]);
  assert.deepEqual(values(copied.text, "RequestId"), [String(copied.answer.headers["x-amz-request-id"])]);
  assert.equal(drive.textAt("copy-fails.pdf"), undefined);
});

test("⛔ what can be refused before storing is refused with its own status, not a 200", async () => {
  shut();
  try {
    const { id } = await begin("refused.bin");
    const wrongTag = Buffer.from(
      `<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"0"</ETag></Part></CompleteMultipartUpload>`,
    );
    const cases: Array<[Promise<Response>, number, string]> = [
      [send(HOST, "POST", `/b/refused.bin?uploadId=${id}`, { body: wrongTag }), 400, "InvalidPart"],
      [send(HOST, "POST", "/b/refused.bin?uploadId=00000000-0000-4000-8000-000000000000", { body: wrongTag }), 404, "NoSuchUpload"],
      [send(HOST, "PUT", "/b/x.pdf", { headers: { "x-amz-copy-source": "b/not-here.pdf" } }), 404, "NoSuchKey"],
      [send(HOST, "PUT", "/b/x.pdf", { headers: { "x-amz-copy-source": "nowhere/x" } }), 404, "NoSuchBucket"],
    ];
    for (const [sent, status, code] of cases) {
      const res = await within(code, sent);
      assert.equal(res.status, status, code);
      assert.equal(res.headers.get("x-amz-request-id"), null, code);
      assert.deepEqual(values(await res.text(), "Code"), [code]);
    }
  } finally {
    open();
  }
});

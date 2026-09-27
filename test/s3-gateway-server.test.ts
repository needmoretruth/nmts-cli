// The socket around the gateway: how long a request may take, `Expect: 100-continue`, a refused
// body that is never read, and a pair list that names one id twice.

import { strict as assert } from "node:assert";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { after, test } from "node:test";

import { NmtsError } from "../src/errors.ts";
import { createGateway, GATEWAY_SERVER_OPTIONS, gatewayHandler, watchBodyIdle } from "../src/s3/server.ts";
import { CREDENTIAL, fakeDrive, listening } from "./s3-gateway-drive.ts";
import { sign } from "./s3-sign.ts";

const drive = await fakeDrive();
const source = drive.source();
const logged: string[] = [];
const gateway = createGateway({
  credentials: [CREDENTIAL],
  bucketOf: (name) => (name === "b" ? source : null),
  log: (line) => logged.push(line),
});
const HOST = await listening(gateway);
after(() => gateway.close());
const PORT = Number(HOST.slice(HOST.lastIndexOf(":") + 1));

interface Heard {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  /** Whether the server said `100 Continue` before its answer. */
  readonly continued: boolean;
}

/**
 * A PUT that asks `Expect: 100-continue` and sends its body only when told to -- or, with
 * `eager`, part of its body at once without waiting, as a client that does not ask would.
 */
function put(target: string, headers: Record<string, string>, body: Buffer, eager = false): Promise<Heard> {
  return new Promise<Heard>((resolve, reject) => {
    let continued = false;
    const req = request({ host: "127.0.0.1", port: PORT, method: "PUT", path: target, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString(), continued }),
      );
    });
    req.on("continue", () => {
      continued = true;
      req.end(body);
    });
    req.on("error", reject);
    if (eager) req.write(body.subarray(0, 1024));
    else if (headers["expect"] === undefined) req.end(body);
  });
}

test("⛔ the server has no limit on a whole request, and keeps Node's limit on headers", () => {
  assert.equal(gateway.requestTimeout, 0);
  assert.equal(gateway.headersTimeout, 60_000);
  assert.deepEqual(GATEWAY_SERVER_OPTIONS, { requestTimeout: 0, headersTimeout: 60_000 });
});

test("⛔ Expect: 100-continue with a signature that does not hold is refused before the body is sent", async () => {
  const body = Buffer.alloc(4 * 1024 * 1024, 1);
  const signed = sign("PUT", "/b/big.bin", HOST, { ...CREDENTIAL, secretAccessKey: "not-the-secret-000000000000" }, new Date(), body);
  const heard = await put("/b/big.bin", { ...signed.headers, "content-length": String(body.length), expect: "100-continue" }, body);
  assert.equal(heard.continued, false);
  assert.equal(heard.status, 403);
  assert.match(heard.body, /<Code>SignatureDoesNotMatch<\/Code>/);
  assert.equal(heard.headers.connection, "close");
  assert.equal(logged.at(-1), "Refused 403");
  assert.equal(drive.textAt("big.bin"), undefined);
});

test("⛔ Expect: 100-continue for a bucket the pair may not touch is refused before the body is sent", async () => {
  const held = { ...CREDENTIAL, buckets: ["elsewhere"] };
  const only = createGateway({ credentials: [held], bucketOf: () => source });
  const host = await listening(only);
  try {
    const body = Buffer.from("x");
    const signed = sign("PUT", "/b/x.bin", host, CREDENTIAL, new Date(), body);
    const heard = await new Promise<Heard>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: Number(host.slice(host.lastIndexOf(":") + 1)),
          method: "PUT",
          path: "/b/x.bin",
          headers: { ...signed.headers, "content-length": "1", expect: "100-continue" },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: "", continued: false }));
        },
      );
      req.on("continue", () => reject(new Error("100 Continue was sent")));
      req.on("error", reject);
    });
    assert.equal(heard.status, 403);
  } finally {
    only.close();
  }
});

test("Expect: 100-continue with a good signature is continued and stored", async () => {
  const body = Buffer.from("sent after the go-ahead");
  const signed = sign("PUT", "/b/continued.txt", HOST, CREDENTIAL, new Date(), body);
  const heard = await put("/b/continued.txt", { ...signed.headers, "content-length": String(body.length), expect: "100-continue" }, body);
  assert.equal(heard.continued, true);
  assert.equal(heard.status, 200, heard.body);
  assert.equal(drive.textAt("continued.txt"), "sent after the go-ahead");
});

test("⛔ a refusal answered while the body is still arriving closes the connection instead of draining it", async () => {
  const body = Buffer.alloc(8 * 1024 * 1024, 2);
  const signed = sign("PUT", "/b/unread.bin", HOST, { ...CREDENTIAL, secretAccessKey: "not-the-secret-000000000000" }, new Date(), body);
  const heard = await put("/b/unread.bin", { ...signed.headers, "content-length": String(body.length) }, body, true);
  assert.equal(heard.status, 403);
  assert.equal(heard.headers.connection, "close");
});

test("⛔ a gateway given two pairs with one id refuses to be made", () => {
  const twin = { accessKeyId: CREDENTIAL.accessKeyId, secretAccessKey: "a-different-secret-for-the-same-id-0000" };
  for (const make of [gatewayHandler, createGateway]) {
    assert.throws(
      () => make({ credentials: [CREDENTIAL, twin], bucketOf: () => null }),
      (error: unknown) => error instanceof NmtsError && /GATEWAY_CREDENTIALS/.test(error.message),
    );
  }
});

// ── The idle limit on a body, with a short limit so it can be watched ────────────────────────────

/** A server that watches bodies with `idleMs` and answers once it has read the body and waited `after`. */
async function idleServer(idleMs: number, afterMs: number): Promise<{ port: number; close: () => void }> {
  const server = createServer(GATEWAY_SERVER_OPTIONS, (req: IncomingMessage, res) => {
    watchBodyIdle(req, idleMs);
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      setTimeout(() => res.end(`read ${Buffer.concat(chunks).length}`), afterMs);
    });
  });
  const host = await listening(server);
  return { port: Number(host.slice(host.lastIndexOf(":") + 1)), close: () => server.close() };
}

/** Send `pieces` one every `gapMs`; answer the status, or "cut" when the connection was closed. */
function trickle(port: number, length: number, pieces: readonly Buffer[], gapMs: number): Promise<string> {
  return new Promise<string>((resolve) => {
    const req = request({ host: "127.0.0.1", port, method: "PUT", path: "/", headers: { "content-length": String(length) } }, (res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => (text += chunk.toString()));
      res.on("end", () => resolve(`${res.statusCode ?? 0} ${text}`));
    });
    req.on("error", () => resolve("cut"));
    let at = 0;
    const next = (): void => {
      const piece = pieces[at];
      at += 1;
      if (piece === undefined) return;
      req.write(piece);
      if (at === pieces.length) req.end();
      else setTimeout(next, gapMs);
    };
    next();
  });
}

test("⛔ a body that stops arriving is cut after the idle limit", async () => {
  const server = await idleServer(300, 0);
  try {
    const started = Date.now();
    // Four bytes promised, two sent, then nothing.
    assert.equal(await trickle(server.port, 4, [Buffer.from("ab")], 0), "cut");
    assert.ok(Date.now() - started < 5_000);
  } finally {
    server.close();
  }
});

test("a body that keeps arriving is not cut, however long it takes in all", async () => {
  const server = await idleServer(300, 0);
  try {
    const pieces = Array.from({ length: 10 }, () => Buffer.from("x"));
    assert.equal(await trickle(server.port, 10, pieces, 100), "200 read 10");
  } finally {
    server.close();
  }
});

test("⛔ once the body is in, a long wait for the answer is not cut", async () => {
  const server = await idleServer(300, 1_200);
  try {
    assert.equal(await trickle(server.port, 3, [Buffer.from("abc")], 0), "200 read 3");
  } finally {
    server.close();
  }
});

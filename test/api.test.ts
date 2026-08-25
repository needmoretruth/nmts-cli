// The HTTP layer, against a real local server. No fetch mocking: the point is what happens on the
// wire, and a stubbed fetch tests only that this file agrees with itself.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";
import { DEFAULT_TIMEOUT_MS, request, ServerError } from "../src/api.ts";
import { NmtsError } from "../src/errors.ts";

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let lastRequest: Recorded | null = null;
let respond: (send: (status: number, body: string, contentType?: string) => void) => void = (send) =>
  send(200, JSON.stringify({ ok: true }));

/**
 * How many of the next requests answer 503 instead of doing what `respond` says.
 *
 * ⛔ A STATUS, NOT A DESTROYED SOCKET. Both mean "try again", and a status is the one a test can
 *    produce reliably — destroying the socket under Node's own fetch is answered by its connection
 *    handling rather than by ours, so the branch never gets reached and the test measures nothing.
 *    The connection-error half of the same question is pinned directly on `isTransient`.
 */
let failNext = 0;

const server: Server = createServer((req, res) => {
  if (failNext > 0) {
    failNext -= 1;
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "UPSTREAM", message: "not now" } }));
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    lastRequest = {
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    respond((status, body, contentType = "application/json") => {
      res.writeHead(status, { "content-type": contentType });
      res.end(body);
    });
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// ⛔ No cast: `address()` can be a string (a unix socket) or null, and asserting the object shape
//    would turn "the server did not bind" into a confusing port of `undefined` much later.
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;

after(() => server.close());

function replyWith(status: number, body: unknown, contentType?: string): void {
  respond = (send) => send(status, typeof body === "string" ? body : JSON.stringify(body), contentType);
}

test("a GET carries no body and no content-type", async () => {
  replyWith(200, { ok: true });
  await request(BASE, "/v1/thing");
  assert.equal(lastRequest?.method, "GET");
  assert.equal(lastRequest?.body, "");
  assert.equal(lastRequest?.headers["content-type"], undefined);
});

test("a POST sends JSON and says so", async () => {
  replyWith(200, { ok: true });
  await request(BASE, "/v1/thing", { method: "POST", body: { a: 1 } });
  assert.equal(lastRequest?.body, '{"a":1}');
  assert.match(String(lastRequest?.headers["content-type"]), /application\/json/);
});

test("⛔ the token goes in one header and nowhere else — never in the path", async () => {
  replyWith(200, { ok: true });
  const TOKEN = "TOKEN-4Q7X2M";
  await request(BASE, "/v1/thing", { token: TOKEN, method: "POST", body: { a: 1 } });
  assert.equal(lastRequest?.headers["authorization"], `Bearer ${TOKEN}`);
  assert.ok(!lastRequest?.url.includes(TOKEN), "the token was in the URL");
  assert.ok(!lastRequest?.body.includes(TOKEN), "the token was in the body");
});

test("an empty token is not sent as an empty Bearer header", async () => {
  replyWith(200, { ok: true });
  await request(BASE, "/v1/thing", { token: "" });
  assert.equal(lastRequest?.headers["authorization"], undefined);
});

test("a refusal comes back as its own code, not as a status number", async () => {
  replyWith(409, { error: { code: "CREDITS_SHORT", message: "Not enough credits." } });
  await assert.rejects(
    () => request(BASE, "/v1/thing"),
    (error: unknown) => {
      assert.ok(error instanceof ServerError);
      assert.equal(error.code, "CREDITS_SHORT");
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("⛔ a clearance refusal explains why a command-line tool cannot satisfy it", async () => {
  // The browser answers this by fetching a fresh captcha token. In Node there is nothing to fetch,
  // and retrying posts an empty token — which surfaces as "the API rejects everything".
  replyWith(403, { error: { code: "CLEARANCE_REQUIRED", message: "Human check required." } });
  await assert.rejects(
    () => request(BASE, "/v1/thing"),
    (error: unknown) => {
      assert.ok(error instanceof ServerError);
      assert.match(error.nextStep ?? "", /command-line tool cannot pass/);
      return true;
    },
  );
});

test("the clearance refusal is returned ONCE — it is not retried", async () => {
  let calls = 0;
  respond = (send) => {
    calls += 1;
    send(403, JSON.stringify({ error: { code: "CLEARANCE_REQUIRED", message: "no" } }));
  };
  await assert.rejects(() => request(BASE, "/v1/thing"));
  assert.equal(calls, 1, "the request was retried");
});

test("a non-JSON body blames what is in front of the server, not the JSON", async () => {
  replyWith(200, "<html>Access denied</html>", "text/html");
  await assert.rejects(
    () => request(BASE, "/v1/thing"),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /not JSON/);
      assert.match(error.nextStep ?? "", /in front of the server/);
      return true;
    },
  );
});

test("an unreachable server says so instead of 'fetch failed'", async () => {
  await assert.rejects(
    // ⛔ One attempt: what this pins is the SHAPE of a single failure, not the retry policy.
    () => request("http://127.0.0.1:1", "/v1/thing", { timeoutMs: 2000, retryBudgetMs: 0 }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /Could not reach/);
      return true;
    },
  );
});

test("⛔ a hung request has a deadline — an agent loop must not wait forever", async () => {
  respond = () => {
    /* never answers */
  };
  const started = Date.now();
  await assert.rejects(
    () => request(BASE, "/v1/thing", { timeoutMs: 300 }),
    (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /did not answer within 300ms/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 3000, "the deadline did not fire");
});

test("the default deadline exists and is not absurd", () => {
  assert.ok(DEFAULT_TIMEOUT_MS > 0 && DEFAULT_TIMEOUT_MS <= 120_000);
});

test("a path that does not start with / is refused, so no absolute URL can redirect the call", async () => {
  await assert.rejects(() => request(BASE, "https://elsewhere.example/v1/thing"), NmtsError);
});

// ── Going on across a link that blinks ───────────────────────────────────────────────────────────
//
// ⛔ WHAT IS PINNED HERE IS THE SAFETY RULE, not the arithmetic (that is `retry-budget.ts`, which
//    the browser and this package share byte for byte). A read may be repeated because repeating
//    it is the same request. A write may NOT, unless it carries an idempotency key — a request
//    that reached the server and died on the way back looks exactly like one that never arrived,
//    and guessing wrong there spends money twice.
test("⭐ a read that fails to connect is tried again, and says so while it waits", async () => {
  // ⛔ An earlier test leaves a server that never answers behind: this is module-level state.
  respond = (send) => send(200, JSON.stringify({ ok: true }));
  const waits: number[] = [];
  failNext = 2;
  const value = await request(BASE, "/v1/thing", { onWait: (info) => waits.push(info.attempt) });
  assert.deepEqual(value, { ok: true });
  assert.equal(failNext, 0, "the two refusals were not made");
  assert.deepEqual(waits, [1, 2], "it waited without telling anybody");
});

test("⛔ a write with no idempotency key is NOT repeated — an unknown outcome can pay twice", async () => {
  // ⛔ An earlier test leaves a server that never answers behind: this is module-level state.
  respond = (send) => send(200, JSON.stringify({ ok: true }));
  failNext = 2;
  await assert.rejects(() => request(BASE, "/v1/thing", { method: "POST", body: {} }));
  assert.equal(failNext, 1, "it sent a write twice without the server's promise that it is one");
  failNext = 0;
});

test("⭐ a write that carries an idempotency key IS repeated — the server dedupes it", async () => {
  // ⛔ An earlier test leaves a server that never answers behind: this is module-level state.
  respond = (send) => send(200, JSON.stringify({ ok: true }));
  failNext = 1;
  const value = await request(BASE, "/v1/thing", {
    method: "POST",
    body: {},
    idempotencyKey: "the-same-request",
  });
  assert.deepEqual(value, { ok: true });
  assert.equal(failNext, 0, "the refusal was not made");
});

test("⛔ a refusal is an answer — it is not asked again", async () => {
  let attempts = 0;
  respond = (send) => {
    attempts += 1;
    send(402, JSON.stringify({ error: { code: "NO_CREDITS", message: "no" } }));
  };
  await assert.rejects(() => request(BASE, "/v1/thing"));
  assert.equal(attempts, 1, "it spent the budget to hear the same no");
});

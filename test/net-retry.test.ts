// What this pins: which failures are worth asking about again, and which are answers.
//
// ⛔ THE ARITHMETIC IS NOT HERE. It is `shared/lib/net/retry-budget.ts`, copied byte for byte from
//    the browser so that both programs mean the same thing by "we tried". What is here is the part
//    that is this package's own: what counts as a blip, and how long a typed command waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLI_RETRY_BUDGET_MS, isTransient, keepTrying } from "../src/net-retry.ts";
import { RETRY_BUDGET_MS, WATCHED_RETRY_BUDGET_MS } from "../src/shared/lib/net/retry-budget.ts";

test("a connection that was refused, reset or never made is worth asking again", () => {
  for (const message of [
    "Could not reach http://x",
    "fetch failed",
    "connect ECONNREFUSED 127.0.0.1:1",
    "read ECONNRESET",
    "getaddrinfo EAI_AGAIN example",
    "socket hang up",
  ]) {
    assert.equal(isTransient(new Error(message)), true, message);
  }
});

test("⛔ a deadline that already fired is not a blip — it had its thirty seconds", () => {
  assert.equal(isTransient(new Error("The server did not answer within 30000ms.")), false);
});

test("⛔ a refusal is an answer — asking again spends the budget to hear the same no", () => {
  for (const status of [400, 401, 402, 403, 404, 409, 422]) {
    assert.equal(isTransient(new Error("refused"), status), false, String(status));
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isTransient(new Error("busy"), status), true, String(status));
  }
});

test("something this does not recognise is not asked again", () => {
  assert.equal(isTransient("not an error"), false);
  assert.equal(isTransient(null), false);
  assert.equal(isTransient(new Error("your file list could not be opened")), false);
});

test("⭐ a typed command waits for less time than anything nobody is watching", () => {
  assert.ok(CLI_RETRY_BUDGET_MS < WATCHED_RETRY_BUDGET_MS);
  assert.ok(CLI_RETRY_BUDGET_MS < RETRY_BUDGET_MS);
  assert.ok(CLI_RETRY_BUDGET_MS >= 10_000, "too short to cross a link that blinks");
});

test("it goes on until it works, and reports the LAST error when the budget is spent", async () => {
  let clock = 0;
  let calls = 0;
  const value = await keepTrying(
    async () => {
      calls += 1;
      if (calls < 4) throw new Error("kill");
      return "landed";
    },
    { retryable: () => true, now: () => clock, random: () => 0, sleep: async (ms) => void (clock += ms) },
  );
  assert.equal(value, "landed");
  assert.equal(calls, 4);

  clock = 0;
  await assert.rejects(
    () =>
      keepTrying(
        async () => {
          throw new Error("still down");
        },
        { retryable: () => true, now: () => clock, random: () => 0, sleep: async (ms) => void (clock += ms) },
      ),
    /still down/,
  );
  assert.ok(clock >= CLI_RETRY_BUDGET_MS);
});

test("⛔ what the caller says is not worth repeating ends after one attempt", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      keepTrying(
        async () => {
          calls += 1;
          throw new Error("no");
        },
        { retryable: () => false, sleep: async () => {} },
      ),
    /no/,
  );
  assert.equal(calls, 1);
});

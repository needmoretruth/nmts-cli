// What this tool says when the server refuses an account that has not accepted the terms in force.
//
// ⛔ THE REFUSAL IS RIGHT AND IS NOT WORKED AROUND. Accepting terms is a person agreeing to a
//    document; a program that did it on their behalf would be signing for somebody else. So what
//    is tested here is not a way through — it is that the caller is told what happened, that
//    nothing on this machine will change it, and what the person has to do. Without that an agent
//    reads a bare 403 and starts changing credentials, which is the one thing that cannot be the
//    cause.
//
// ⛔ THE CODE IS THE SERVER'S, SPELLED THE SERVER'S WAY. `TERMS_ACCEPTANCE_REQUIRED` with a 403 is
//    what `api/src/error.rs` sends, and it carries a message and no `details` — so nothing here
//    may depend on a field arriving beside it.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, test } from "node:test";

import { request, ServerError } from "../src/api.ts";

const CODE = "TERMS_ACCEPTANCE_REQUIRED";
const MESSAGE = "the terms in force have not been accepted for this account";

let asked = 0;
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true } };

const server: Server = createServer((_req, res) => {
  asked += 1;
  res.writeHead(answer.status, { "content-type": "application/json" });
  res.end(JSON.stringify(answer.body));
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

function refuseWithTerms(): void {
  asked = 0;
  answer = { status: 403, body: { error: { code: CODE, message: MESSAGE } } };
}

/** The refusal, as the caller receives it. */
async function refusal(): Promise<ServerError> {
  const thrown = await request(BASE, "/v1/items", { method: "POST", body: {} }).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(thrown instanceof ServerError, "a terms refusal did not arrive as a named refusal");
  return thrown;
}

test("the refusal keeps its own code and status, so a caller can branch without matching text", async () => {
  refuseWithTerms();
  const error = await refusal();
  assert.equal(error.code, CODE);
  assert.equal(error.status, 403);
  assert.equal(error.message, MESSAGE, "the server's own words were replaced");
});

test("⛔ it says what happened, that nothing here can fix it, and what the person must do", async () => {
  refuseWithTerms();
  const advice = (await refusal()).nextStep;
  // ⛔ The gap this closes: there was no branch, so this was null and an agent got a bare 403.
  assert.ok(advice !== null && advice !== "", "a terms refusal came back with no advice at all");
  assert.match(advice, /not accepted the terms/i, "it does not say what happened");
  assert.match(advice, /Nothing on this machine can accept them/i, "it does not say that this machine cannot");
  assert.match(advice, /person/i, "it does not say who has to act");
  assert.match(advice, /nmts\.me/, "it does not say where");
});

test("⛔ it does not send the caller after the credentials — they are not the problem", async () => {
  refuseWithTerms();
  const advice = (await refusal()).nextStep ?? "";
  // A version that reused the UNAUTHORIZED wording would pass every assertion about being
  // non-empty, and would send an agent to make a new key for a refusal no key can lift.
  assert.doesNotMatch(advice, /API key|NMTS_API_KEY|make a new (one|key)/i, "it blames the credential");
  assert.doesNotMatch(advice, /try again|retry/i, "it invites a retry that cannot succeed");
});

test("⛔ the refusal is returned once — nothing retries it and nothing tries to accept for anybody", async () => {
  refuseWithTerms();
  await refusal();
  assert.equal(asked, 1, "the request was repeated");
});

test("a refusal this tool has no advice for still arrives whole, with nothing invented", async () => {
  // ⛔ Discriminating: it proves the branch above is a branch and not a blanket sentence attached
  //    to every refusal. `VALIDATION` is deliberately silent — the server's own message names the
  //    field that was wrong, so advice would only repeat it — and `check:advice` holds that
  //    decision written down beside the reason.
  //
  // ⚠ This used to use `TERMS_VERSION_MISMATCH`, which stopped being silent on 2026-08-30 when the
  //   advice table went from 13 codes to 40. If this fails again because the code chosen here
  //   gained advice, move it to another silent code — do not delete the test.
  asked = 0;
  answer = {
    status: 400,
    body: { error: { code: "VALIDATION", message: "terms_version must be 2026-08-11-v9" } },
  };
  const error = await refusal();
  assert.equal(error.code, "VALIDATION");
  assert.equal(error.nextStep, null);
  assert.match(error.message, /2026-08-11-v9/);
});

test("and a refusal it does have advice for carries it — the two halves in one test", async () => {
  // ⛔ Without this, the test above passes just as well if `adviseFor` returns null for everything.
  asked = 0;
  answer = {
    status: 422,
    body: { error: { code: "TERMS_VERSION_MISMATCH", message: "terms_version must be 2026-08-11-v9" } },
  };
  const error = await refusal();
  assert.equal(error.code, "TERMS_VERSION_MISMATCH");
  assert.match(error.nextStep ?? "", /versions/i, "the code gained advice and lost it again");
});

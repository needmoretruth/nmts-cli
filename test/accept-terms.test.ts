// `nmts accept-terms` against the fake server: what is sent, what is refused, and what is said.
//
// ⛔ THE ONE THAT MATTERS MOST IS THE REFUSAL. Accepting is a person reading a document and
//    agreeing; a mode that lets an agent decide must not reach the door at all, and a regression
//    there is silent — an acceptance gets written that nobody made.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { identityOf } from "../src/account.ts";
import { accountProof } from "../src/account-proof.ts";
import { ServerError } from "../src/api.ts";
import { setMode } from "../src/autonomy.ts";
import { acceptTerms } from "../src/commands/accept-terms.ts";
import { NmtsError } from "../src/errors.ts";
import { accountState } from "./fake-account.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** Answers the two questions in order, and records what was asked. */
function typed(answers: readonly string[]): { readLine: (q: string) => Promise<string>; asked: string[] } {
  const asked: string[] = [];
  let index = 0;
  return {
    asked,
    readLine: async (question: string) => {
      asked.push(question);
      return answers[index++] ?? "";
    },
  };
}

test("it sends the account id, the sign-in proof and the two typed versions — never the code", async () => {
  await withSandbox(drive, "accept-terms-sends", async (code) => {
    const out = collect();
    const input = typed(["2026-09-10-v11", "2026-09-10-v12"]);
    assert.equal(await acceptTerms({ server: drive.base, write: out.write, readLine: input.readLine }), 0);

    assert.equal(accountState.acceptRequests.length, 1, "the acceptance door was not called once");
    const body = accountState.acceptRequests[0];
    assert.ok(body !== null && typeof body === "object");
    const sent = body as Record<string, unknown>;
    const identity = await identityOf(code);
    assert.equal(sent["account_id"], identity.accountId);
    assert.equal(sent["auth_secret"], await accountProof(code), "the proof is not the sign-in one");
    assert.equal(sent["terms_version"], "2026-09-10-v11");
    assert.equal(sent["privacy_version"], "2026-09-10-v12");
    const raw = JSON.stringify(sent);
    assert.ok(!raw.includes(code.replace(/[\s-]/gu, "")), "the NMTS key was sent to the server");

    // Two questions, in the browser's order: consent to the Terms, then having read the Policy.
    assert.equal(input.asked.length, 2);
    assert.match(input.asked[0] ?? "", /Terms of Service version you have read and accept/);
    assert.match(input.asked[1] ?? "", /Privacy Policy version you have read/);
    assert.deepEqual(out.lines.slice(0, 2), [
      "In force: Terms of Service 2026-09-10-v11 · Privacy Policy 2026-09-10-v12.",
      "This account has not accepted this pair, so uploads and shares are refused until it does.",
    ]);
    assert.equal(
      out.lines.at(-2),
      "Recorded: this account accepts the Terms of Service 2026-09-10-v11 and has read the Privacy Policy 2026-09-10-v12.",
    );
  });
});

test("with --accept-terms and --accept-privacy the versions come from the command line and nothing is asked", async () => {
  await withSandbox(drive, "accept-terms-relayed", async () => {
    const input = typed(["wrong", "wrong"]);
    assert.equal(
      await acceptTerms({ server: drive.base, terms: "2026-09-10-v11", privacy: "2026-09-10-v12", write: collect().write, readLine: input.readLine }),
      0,
    );
    assert.equal(input.asked.length, 0, "a version was asked for although both were given");
    assert.equal(accountState.acceptRequests.length, 1);
    assert.equal(accountState.acceptRequests[0]?.terms_version, "2026-09-10-v11");
  });
});
test("an account that already accepted is told so, and nothing is sent", async () => {
  await withSandbox(drive, "accept-terms-current", async () => {
    accountState.summary = {
      terms: {
        acceptance_required: false,
        required_terms_version: "2026-09-10-v11",
        required_privacy_version: "2026-09-10-v12",
      },
    };
    const out = collect();
    const input = typed(["2026-09-10-v11", "2026-09-10-v12"]);
    assert.equal(await acceptTerms({ server: drive.base, write: out.write, readLine: input.readLine }), 0);
    assert.equal(input.asked.length, 0);
    assert.equal(accountState.acceptRequests.length, 0);
    assert.deepEqual(out.lines, [
      "This account has already accepted the documents in force (Terms of Service 2026-09-10-v11 · " +
        "Privacy Policy 2026-09-10-v12). Nothing to do.",
    ]);
  });
});

test("an empty answer accepts nothing, and says so with a non-zero exit", async () => {
  await withSandbox(drive, "accept-terms-empty", async () => {
    const out = collect();
    const input = typed(["2026-09-10-v11", ""]);
    assert.equal(await acceptTerms({ server: drive.base, write: out.write, readLine: input.readLine }), 1);
    assert.equal(accountState.acceptRequests.length, 0, "an empty answer reached the door");
    assert.equal(out.lines.at(-1), "Nothing was accepted.");
  });
});

test("a version that is not the pair in force is the server's refusal, with its own code", async () => {
  await withSandbox(drive, "accept-terms-stale", async () => {
    accountState.refuseAcceptWith = {
      status: 422,
      code: "TERMS_VERSION_MISMATCH",
      message: "terms_version/privacy_version must be 2026-09-10-v11 / 2026-09-10-v12",
    };
    const input = typed(["2026-08-24-v10", "2026-08-24-v9"]);
    await assert.rejects(
      () => acceptTerms({ server: drive.base, write: collect().write, readLine: input.readLine }),
      (error: unknown) => {
        assert.ok(error instanceof ServerError);
        assert.equal(error.code, "TERMS_VERSION_MISMATCH");
        assert.match(error.message, /2026-09-10-v11/, "the refusal does not name the pair in force");
        return true;
      },
    );
  });
});

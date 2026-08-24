// `nmts trial` against a real local server — the two routes it reads and writes, and the
// sentences it produces for each answer they can give.
//
// ⛔ WHAT IS BEING HELD HERE IS MOSTLY WORDING, and that is not a soft claim. This command's whole
//    job is to state rules it does not own and to pass on refusals it cannot work around: a
//    refusal explained as the wrong thing sends an agent to make another credential, which is the
//    one action that can never help.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { trial } from "../src/commands/trial.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);

let verified = true;
let week = {
  live: true,
  round: "2026-W34",
  computed: true,
  winners: 19,
  credits_per_winner: 64,
  slots_left: 3,
  already: false,
  held: false,
};
/** When set, `POST /v1/trial/apply` refuses with this code instead of granting. */
let refuseApplyWith: string | null = null;
let calls: string[] = [];
let base = "";

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push(`${method} ${path}`);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (method === "GET" && path === "/v1/agent/verify") {
    return send(200, {
      verified,
      round_key: verified ? week.round : null,
      verified_until: verified ? "2026-09-21T00:00:00Z" : null,
    });
  }
  if (method === "GET" && path === "/v1/trial") return send(200, week);
  if (method === "POST" && path === "/v1/trial/apply") {
    if (refuseApplyWith !== null) {
      return send(403, { error: { code: refuseApplyWith, message: "refused by the test" } });
    }
    return send(201, { credits: 64, expires_at: "2026-09-21T00:00:00Z", round: week.round });
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  verified = true;
  refuseApplyWith = null;
  calls = [];
  week = {
    live: true,
    round: "2026-W34",
    computed: true,
    winners: 19,
    credits_per_winner: 64,
    slots_left: 3,
    already: false,
    held: false,
  };
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [["NMTS_CONFIG_DIR", before.dir], [API_KEY_ENV_VAR, before.key]] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function refusalFrom(action: string | undefined): Promise<NmtsError> {
  const failed = await trial(action, { server: base, network: "testnet", write: () => {} }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(failed instanceof NmtsError, "the run was allowed through");
  return failed;
}

test("⛔ reading the week states the rules and takes nothing", async () => {
  await withSandbox("trial-read", async () => {
    const out = collect();
    assert.equal(await trial(undefined, { server: base, network: "testnet", write: out.write }), 0);
    const said = out.lines.join("\n");

    // The three rules, in the words this command promises to state rather than to bend.
    assert.match(said, /one application per account per week/u);
    assert.match(said, /first come, first served/u);
    assert.match(said, /no way to ask for more/u);
    // The meter, as two numbers the server owns.
    assert.match(said, /3 of 19/u);
    assert.match(said, /64 credits/u);
    // ⛔ AND NOTHING WAS ASKED FOR. A read that applied would spend the account's one chance for
    //    the week on somebody who wanted to know how many places were left.
    assert.ok(!calls.some((c) => c.startsWith("POST")), `a read applied: ${calls.join(" · ")}`);
  });
});

test("⛔ with no live human check the caller is sent to `nmts verify`, and the trial is not read", async () => {
  await withSandbox("trial-unverified", async () => {
    verified = false;
    const failed = await refusalFrom(undefined);
    assert.match(String(failed.nextStep), /nmts verify/u);
    assert.ok(!/scope|permission/iu.test(`${failed.message} ${failed.nextStep}`));
    assert.ok(!calls.includes("GET /v1/trial"), "a refusal that was already certain was sent anyway");
  });
});

test("⛔ applying reports the grant, and asks once", async () => {
  await withSandbox("trial-apply", async () => {
    const out = collect();
    assert.equal(await trial("apply", { server: base, network: "testnet", write: out.write }), 0);
    assert.match(out.lines.join("\n"), /Granted: 64 credits/u);
    assert.equal(calls.filter((c) => c === "POST /v1/trial/apply").length, 1);
  });
});

test("⛔ an account that already has its place is told so, and does not apply again", async () => {
  await withSandbox("trial-already", async () => {
    week = { ...week, already: true };
    const out = collect();
    // Not a failure: the account holds the thing the command asks for.
    assert.equal(await trial("apply", { server: base, network: "testnet", write: out.write }), 0);
    assert.match(out.lines.join("\n"), /already took its place/u);
    assert.ok(!calls.some((c) => c.startsWith("POST")), "a second application was sent");
  });
});

test("⛔ the browser check this tool cannot pass is named as itself, not as a credential problem", async () => {
  await withSandbox("trial-turnstile", async () => {
    refuseApplyWith = "TURNSTILE_FAILED";
    const failed = await refusalFrom("apply");
    const said = `${failed.message}\n${failed.nextStep}`;
    assert.match(said, /browser/u);
    // ⛔ THE ADVICE `api.ts` CARRIES FOR THIS CODE IS WRONG HERE — it says an API key waives the
    //    check, which is true of signing in and false of this route. A caller that read it would
    //    make a key and be refused again.
    assert.ok(!/API key/iu.test(said), `it blamed the credential: ${said}`);
    assert.match(said, /nmts verify.+does not stand\s+in for this one/su);
  });
});

test("⛔ a full week is passed on as a full week, with no retry suggested", async () => {
  await withSandbox("trial-full", async () => {
    refuseApplyWith = "TRIAL_FULL";
    const failed = await refusalFrom("apply");
    assert.match(failed.message, /Every place in this week is taken/u);
    assert.match(String(failed.nextStep), /first come, first served/u);
    assert.ok(!/try again/iu.test(String(failed.nextStep)), "an agent was told to retry a full week");
  });
});

test("⛔ a word this command does not know is refused rather than guessed at", async () => {
  await withSandbox("trial-unknown-word", async () => {
    const failed = await refusalFrom("claim");
    assert.equal(failed.exitCode, 2);
    assert.equal(calls.length, 0, "a request was made for a command line that was not understood");
  });
});

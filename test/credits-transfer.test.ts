// `nmts credits transfer` against a server answering on this machine.
//
// ⛔ THE ONE THAT MATTERS MOST is that each of the four refusals arrives with ITS OWN next step.
//    The server split them apart because they are cleared by four different acts — name an
//    account of your own · name a different one · send less · send some — and a tool that handed
//    a program one sentence for all four would send it to do the wrong one, or to retry the only
//    thing that cannot work. That advice is not written in the command: `api.ts` attaches it from
//    the one table `check:advice` holds against the server's own codes, and this measures that it
//    actually reaches the caller.
//
// ⛔ AND THAT A COMMAND LINE NOBODY COULD HAVE MEANT COSTS NO REQUEST. A missing `--to` and an
//    amount that is not a whole number above zero are fixed here, not asked about — and the
//    assertion that the server was never called is what makes that a fact rather than an
//    intention.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";

import { ServerError } from "../src/api.ts";
import { credits } from "../src/commands/credits.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { NETWORK_ENV_VAR } from "../src/network.ts";
import { SERVER_ENV_VAR } from "../src/server.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const THEM = "Zm9vYmFyLWFjY291bnQtaWQ";

/** What the server does next, and what it was asked. Reset per test. */
let verified = true;
let answer: { status: number; body: unknown } = {
  status: 200,
  body: { credits: 5, from_balance: 80, to_balance: 50 },
};
let asked: { path: string; body: unknown }[] = [];

const server: Server = createServer((req, res) => {
  const url = req.url ?? "";
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.startsWith("/v1/agent/verify") && req.method === "GET") {
    asked.push({ path: url, body: null });
    return send(200, { verified, verified_until: "2026-10-05T00:00:00Z" });
  }
  if (url.startsWith("/v1/credits/transfer") && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => (raw += String(chunk)));
    req.on("end", () => {
      asked.push({ path: url, body: JSON.parse(raw) });
      send(answer.status, answer.body);
    });
    return;
  }
  send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = server.address();
if (port === null || typeof port !== "object") throw new Error("no port");
const BASE = `http://127.0.0.1:${port.port}`;
after(() => server.close());

async function sandbox(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { ...process.env };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  process.env[SERVER_ENV_VAR] = BASE;
  process.env[NETWORK_ENV_VAR] = "testnet";
  verified = true;
  answer = { status: 200, body: { credits: 5, from_balance: 80, to_balance: 50 } };
  asked = [];
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const n of ["NMTS_CONFIG_DIR", API_KEY_ENV_VAR, SERVER_ENV_VAR, NETWORK_ENV_VAR]) {
      const was = before[n];
      if (was === undefined) delete process.env[n];
      else process.env[n] = was;
    }
  }
}

/** Run the command and hand back what it printed. */
async function run(amount: string | undefined, options: Record<string, unknown> = {}): Promise<string[]> {
  const lines: string[] = [];
  const code = await credits("transfer", amount, {
    to: THEM,
    write: (l) => lines.push(l),
    ...options,
  });
  assert.equal(code, 0, "the command did not report success");
  return lines;
}

/** The failure a run produced, or null when it produced none. */
async function refusal(amount: string | undefined, options: Record<string, unknown> = {}): Promise<unknown> {
  return credits("transfer", amount, { to: THEM, write: () => {}, ...options }).then(
    () => null,
    (error: unknown) => error,
  );
}

test("a move sends the amount and the recipient, and prints both balances back", async () => {
  await sandbox("credits-happy", async () => {
    const said = (await run("5")).join("\n");
    const sent = asked.find((a) => a.path.startsWith("/v1/credits/transfer"));
    assert.deepEqual(sent?.body, { to: THEM, credits: 5 }, "the request body is not what was typed");
    assert.match(said, /Sent 5 credits/);
    // ⛔ BOTH SIDES, because the point of moving credits is where they ended up: a run that
    //    printed only the sender's total would need a second command to answer the question it
    //    was run to answer.
    assert.match(said, /this account {3}80 credits/);
    assert.match(said, /that account {3}50 credits/);
    // The one fact a person can be wrong about afterwards, said at the moment it happens.
    assert.match(said, /does not renew/);
  });
});

test("one credit is said in the singular", async () => {
  await sandbox("credits-one", async () => {
    answer = { status: 200, body: { credits: 1, from_balance: 1, to_balance: 1 } };
    assert.match((await run("1")).join("\n"), /Sent 1 credit\b/);
  });
});

test("--json carries the server's own three numbers and the recipient this run named", async () => {
  await sandbox("credits-json", async () => {
    const lines = await run("5", { json: true });
    assert.equal(lines.length, 1, "--json printed more than the one object");
    assert.deepEqual(JSON.parse(lines[0] ?? ""), {
      to: THEM,
      credits: 5,
      from_balance: 80,
      to_balance: 50,
    });
  });
});

test("⛔ a command line nobody could have meant is refused before the server is asked anything", async () => {
  await sandbox("credits-operands", async () => {
    for (const bad of [undefined, "", "0", "-1", "1.5", "five", "1e3000"]) {
      const failure = await refusal(bad);
      assert.ok(failure instanceof NmtsError, `"${String(bad)}" was not refused`);
      assert.equal(failure.exitCode, 2, `"${String(bad)}" was not refused as a command-line fault`);
    }
    const missingTo = await refusal("5", { to: "  " });
    assert.ok(missingTo instanceof NmtsError);
    assert.equal(missingTo.exitCode, 2);
    assert.match(missingTo.message, /--to/);
    assert.deepEqual(asked, [], `it asked the server: ${asked.map((a) => a.path).join(" · ")}`);
  });
});

test("the wrong word after `credits` names the one verb, and takes no network", async () => {
  await sandbox("credits-verb", async () => {
    const failure = await credits("balance", "5", { to: THEM, write: () => {} }).then(
      () => null,
      (error: unknown) => error,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 2);
    assert.match(failure.nextStep ?? "", /credits transfer --to/);
    assert.deepEqual(asked, []);
  });
});

test("a lapsed human check is named as a person's act, not as a credential problem", async () => {
  await sandbox("credits-verify", async () => {
    verified = false;
    const failure = await refusal("5");
    assert.ok(failure instanceof NmtsError, "a lapsed check was not refused");
    assert.equal(failure.exitCode, 4);
    // ⛔ THE COMMAND, NOT THE CREDENTIAL. An agent told "refused" starts making new keys, which is
    //    the one remedy that cannot help.
    assert.match(failure.nextStep ?? "", /nmts verify/);
    assert.equal(
      asked.filter((a) => a.path.startsWith("/v1/credits/transfer")).length,
      0,
      "it sent the transfer anyway",
    );
  });
});

test("each of the four refusals arrives with its own next step", async () => {
  const cases: [number, string, RegExp][] = [
    [403, "CREDIT_TRANSFER_OUTSIDE_FAMILY", /own accounts/i],
    [422, "CREDIT_TRANSFER_SELF", /the account sending/i],
    [402, "CREDIT_TRANSFER_INSUFFICIENT", /smaller number/i],
    [422, "CREDIT_TRANSFER_ZERO", /above zero/i],
  ];
  const seen = new Set<string>();
  for (const [status, code, advice] of cases) {
    await sandbox(`credits-${code}`, async () => {
      answer = { status, body: { error: { code, message: `refused: ${code}` } } };
      const failure = await refusal("5");
      assert.ok(failure instanceof ServerError, `${code} did not arrive as a server refusal`);
      assert.equal(failure.code, code);
      assert.equal(failure.status, status);
      const step = failure.nextStep ?? "";
      assert.match(step, advice, `${code} carried the wrong advice: ${step}`);
      // ⛔ FOUR SENTENCES AND NOT ONE. A remedy shared between two of these is a remedy that is
      //    wrong for at least one of them.
      assert.ok(!seen.has(step), `${code} repeats another refusal's advice word for word`);
      seen.add(step);
      // ⚠ None of them tells a program to try again: three are decided by the request itself and
      //   the fourth by how many credits the account holds.
      assert.doesNotMatch(step, /try again|retry/i);
    });
  }
});

test("the numbers an insufficient balance carries reach the caller", async () => {
  await sandbox("credits-insufficient-details", async () => {
    answer = {
      status: 402,
      body: {
        error: {
          code: "CREDIT_TRANSFER_INSUFFICIENT",
          message: "this transfer needs 5 credits and this account can spend 2",
          details: { needed_credits: 5, balance_credits: 2 },
        },
      },
    };
    const failure = await refusal("5");
    assert.ok(failure instanceof ServerError);
    assert.deepEqual(failure.details, { needed_credits: 5, balance_credits: 2 });
  });
});

test("an answer this version cannot read says the move happened anyway", async () => {
  await sandbox("credits-shape", async () => {
    answer = { status: 200, body: { moved: 5 } };
    const failure = await refusal("5");
    assert.ok(failure instanceof NmtsError);
    // ⛔ NOT "it failed". The server answered 200: the credits moved, and telling somebody
    //    otherwise would have them send a second time.
    assert.match(failure.message, /moved the credits/);
    assert.match(failure.nextStep ?? "", /balance/);
  });
});

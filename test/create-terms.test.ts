// What `nmts create` does about the two documents a server is enforcing.
//
// ⛔ THE CLAIM UNDER TEST IS A NEGATIVE ONE: the tool reads the versions in force and still does
//    not send them unless a person named the same pair. A test that only checked the happy path
//    would pass just as well against a tool that filled them in for itself, which is the one
//    behaviour the server's own rule forbids — a machine cannot consent, and a credential that
//    could accept would produce exactly the unrecorded acceptance the record exists to prevent.
//
// ⚠ SEPARATE FROM `create.test.ts` because it is a separate claim, and because one file holding
//   both would be past the length gate. Its fake server is small on purpose: nothing here needs
//   the account to come back, only what the request carried.

import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { create } from "../src/commands/create.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
/** Shaped like the real pair: what the server calls the documents it is enforcing today. */
const TERMS = "2026-08-11-v9";
const PRIVACY = "2026-08-11-p4";

let inForce: { terms: string; privacy: string } | null = null;
let received: Record<string, unknown> | null = null;
let base = "";

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (method === "GET" && path === "/v1/agent/verify") {
    return send(200, { verified: true, round_key: "2026-W34", verified_until: "2026-09-21T00:00:00Z" });
  }
  if (method === "GET" && path === "/v1/account/summary") {
    return send(200, {
      credits: { remaining: 0, soonest_expiry: null, file_cap: 1, daily_cap: 1 },
      quota: { granted: 0, used: 0 },
      storage: { parts: 0, earliest_expiry_epoch: null },
      terms: {
        acceptance_required: false,
        required_terms_version: inForce?.terms ?? null,
        required_privacy_version: inForce?.privacy ?? null,
      },
    });
  }
  if (method === "POST" && path === "/v1/accounts") {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      const body: unknown = JSON.parse(raw);
      received = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : null;
      const id: unknown = received?.["account_id"];
      send(201, {
        account: {
          account_id: typeof id === "string" ? id : "",
          kdf_version: 3,
          status: "active",
          created_at: "2026-08-24T00:00:00Z",
        },
      });
    });
    return;
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
  inForce = { terms: TERMS, privacy: PRIVACY };
  received = null;
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

async function refusalFrom(options: Parameters<typeof create>[0]): Promise<NmtsError> {
  const failed = await create(options).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(failed instanceof NmtsError, "the run was allowed to create an account");
  return failed;
}

test("⛔ nobody having accepted stops the run, and the tool does not accept for them", async () => {
  await withSandbox("create-terms-none", async () => {
    const failed = await refusalFrom({ server: base, network: "testnet", write: () => {} });
    // 5 is this tool's code for "waiting on the person's agreement".
    assert.equal(failed.exitCode, 5);
    assert.equal(received, null, "an account was created with an acceptance nobody gave");
    const said = `${failed.message}\n${failed.nextStep}`;
    // It has just READ both versions. Printing them is what lets a person go and read the
    // documents; sending them is what it must not do, and the line above is what proves it did not.
    assert.match(said, new RegExp(TERMS, "u"));
    assert.match(said, new RegExp(PRIVACY, "u"));
    assert.match(said, /--accept-terms/u);
    assert.match(said, /machine cannot\s+consent/u);
    assert.match(said, /Do not run that command yourself/u);
  });
});

test("⛔ naming the wrong documents is refused, and nothing is created", async () => {
  await withSandbox("create-terms-stale", async () => {
    const failed = await refusalFrom({
      server: base,
      network: "testnet",
      acceptTerms: "2026-07-01-v8",
      acceptPrivacy: PRIVACY,
      write: () => {},
    });
    assert.equal(failed.exitCode, 5);
    assert.equal(received, null, "a stale acceptance was recorded");
    assert.match(failed.message, /not the ones in force/u);
  });
});

test("⛔ naming both versions sends exactly those, and no others", async () => {
  await withSandbox("create-terms-accepted", async () => {
    const code = await create({
      server: base,
      network: "testnet",
      acceptTerms: TERMS,
      acceptPrivacy: PRIVACY,
      write: () => {},
    });
    assert.equal(code, 0);
    assert.equal(received?.["terms_version"], TERMS);
    assert.equal(received?.["privacy_version"], PRIVACY);
  });
});

test("⛔ where no documents are in force, no acceptance is sent at all", async () => {
  await withSandbox("create-terms-off", async () => {
    inForce = null;
    assert.equal(await create({ server: base, network: "testnet", write: () => {} }), 0);
    assert.ok(received !== null, "nothing was created");
    // ⛔ ABSENT, NOT EMPTY. An empty pair is a claim that something was accepted; the server would
    //    ignore it today, and a record of consent to nothing is the thing being avoided.
    assert.ok(!("terms_version" in received), "an acceptance was sent where there is nothing to accept");
    assert.ok(!("privacy_version" in received), "an acceptance was sent where there is nothing to accept");
  });
});

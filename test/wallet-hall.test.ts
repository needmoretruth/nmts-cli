// `nmts wallet hall` — the gift list a person reads, and the signed message that puts a name in it.
//
// ⛔ WHAT THE SIGNING TEST HAS TO HOLD. The server rebuilds the signed bytes from the fields it was
//    sent and checks the signature against them, so the ONE thing that can silently break this
//    command is the message text. The four lines are therefore written out here BY HAND rather
//    than built with `hallMessage` — a test that called that function would only prove it agrees
//    with itself, and the failure it has to catch is exactly a drift between the two sides.
//
// ⚠ Nothing here signs for real: the signature is a seam. What a real key does with those bytes is
//   `wallet-sign.test.ts`'s subject, and it is the same keypair either way.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { parseArgs } from "../src/args.ts";
import { walletHall } from "../src/commands/wallet-hall.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { ACTS, actOf } from "../src/risk.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

interface Posted {
  address: unknown;
  name: unknown;
  issuedAt: unknown;
  signature: unknown;
}

interface State {
  /** What `GET /v1/gifts/hall` answers. */
  hall: unknown;
  /** What `POST /v1/gifts/listing` answers, and with which status. */
  listingStatus: number;
  listing: unknown;
  /** Every listing body the tool sent, in order. */
  posted: Posted[];
}

interface Fake {
  base: string;
  state: State;
  stop: () => Promise<void>;
}

async function fake(): Promise<Fake> {
  const state: State = { hall: {}, listingStatus: 200, listing: { listed: true, label: "alice" }, posted: [] };
  const server: Server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (incoming.url === "/v1/gifts/hall") {
        response.writeHead(200).end(JSON.stringify(state.hall));
        return;
      }
      if (incoming.url === "/v1/gifts/listing" && incoming.method === "POST") {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const read = (key: string): unknown =>
          typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
        state.posted.push({
          address: read("address"),
          name: read("name"),
          issuedAt: read("issuedAt"),
          signature: read("signature"),
        });
        response.writeHead(state.listingStatus).end(JSON.stringify(state.listing));
        return;
      }
      response.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address();
  if (bound === null || typeof bound === "string") throw new Error("the fake server has no port");
  return {
    base: `http://127.0.0.1:${bound.port}`,
    state,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const HALL = {
  developer: { label: "needmoretruth", address: "0xdev", explorerUrl: "https://example.test/dev" },
  referenceRate: { suiPerWal: 0.5, measuredOn: "2026-09-03" },
  rankedAt: "2026-09-06T00:00:00.000Z",
  entries: Array.from({ length: 12 }, (_, index) => ({
    rank: index + 1,
    label: index === 0 ? "alice" : `0x1a2b${index}…9f3e`,
    listed: index === 0,
    explorerUrl: "https://example.test/x",
    sui: `${1_000_000_000 - index}`,
    wal: `${2_000_000_000 - index}`,
    gifts: 1,
  })),
};

async function withAccount(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  process.env[CODE_ENV_VAR] = await generateCode();
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** A signature that is never a real one, and a record of exactly what it was asked to sign. */
function recordingSigner(): { asked: string[]; sign: (input: { code: string; message: string }) => Promise<string> } {
  const asked: string[] = [];
  return {
    asked,
    sign: async ({ message }) => {
      asked.push(message);
      return "c2lnbmF0dXJl";
    },
  };
}

test("the hall prints the developer, ten rows, and how many more the site holds", async () => {
  const server = await fake();
  server.state.hall = HALL;
  try {
    const out = collect();
    assert.equal(await walletHall({ server: server.base, write: out.write }), 0);
    const text = out.lines.join("\n");
    assert.match(text, /needmoretruth — builds NMTS/);
    assert.match(text, /^ {2}0xdev$/m);
    // The amounts are the CLI's own coin formatting of the base units the server sent.
    assert.match(text, /^ {4}1\. alice\s+2 WAL\s+1 SUI$/m);
    assert.equal(text.split("\n").filter((line) => /^\s+\d+\. /.test(line)).length, 10, "not ten rows");
    assert.match(text, /2 more entries are in the list at https:\/\/nmts\.me\/hall\./);
    assert.match(text, /reference rate measured on 2026-09-03/);
  } finally {
    await server.stop();
  }
});

test("⛔ --name signs the four lines the server rebuilds, and sends exactly them", async () => {
  const server = await fake();
  try {
    await withAccount("wallet-hall-name", async () => {
      const out = collect();
      const signer = recordingSigner();
      assert.equal(
        await walletHall({ server: server.base, write: out.write, name: "alice", sign: signer.sign }),
        0,
      );
      const sent = server.state.posted[0];
      assert.ok(sent !== undefined, "nothing was posted");
      assert.equal(sent.name, "alice");
      assert.equal(sent.signature, "c2lnbmF0dXJl");
      assert.equal(typeof sent.issuedAt, "string");
      assert.equal(new Date(String(sent.issuedAt)).toISOString(), sent.issuedAt, "issuedAt is not an ISO instant");
      assert.equal(signer.asked.length, 1);
      assert.equal(
        signer.asked[0],
        `NMTS hall of fame\naddress: ${String(sent.address)}\nname: alice\nat: ${String(sent.issuedAt)}`,
      );
      assert.match(out.lines.join("\n"), /^Listed as alice$/m);
    });
  } finally {
    await server.stop();
  }
});

test("--remove sends a null name, and signs `(none)` in its place", async () => {
  const server = await fake();
  server.state.listing = { listed: false, label: "0x1a2b…9f3e" };
  try {
    await withAccount("wallet-hall-remove", async () => {
      const signer = recordingSigner();
      const out = collect();
      assert.equal(await walletHall({ server: server.base, write: out.write, remove: true, sign: signer.sign }), 0);
      const sent = server.state.posted[0];
      assert.ok(sent !== undefined, "nothing was posted");
      assert.equal(sent.name, null, "a removal must send null, not an empty string");
      assert.match(String(signer.asked[0]), /^name: \(none\)$/mu);
      assert.match(out.lines.join("\n"), /^Listed as 0x1a2b…9f3e$/m);
    });
  } finally {
    await server.stop();
  }
});

test("⛔ each refusal the server can send has one plain line of its own", async () => {
  const expected: ReadonlyArray<[string, RegExp]> = [
    ["gift_not_found", /not in the list yet\. It appears within an hour; try again then\./],
    ["name_invalid", /^A name is 1 to 24 characters, no links, not an address\.$/],
    ["listing_stale", /^A newer listing request exists; try again\.$/],
    ["signature_invalid", /^The server did not accept the signature\.$/],
  ];
  const server = await fake();
  try {
    await withAccount("wallet-hall-refusals", async () => {
      for (const [code, line] of expected) {
        server.state.listingStatus = code === "gift_not_found" ? 404 : code === "listing_stale" ? 409 : 422;
        server.state.listing = { error: { code, message: "the server's own words, which may be rewritten" } };
        const signer = recordingSigner();
        const failure = await walletHall({
          server: server.base,
          write: () => undefined,
          name: "alice",
          sign: signer.sign,
        }).then(
          () => null,
          (error: unknown) => error,
        );
        assert.ok(failure instanceof NmtsError, `${code} did not refuse — ${String(failure)}`);
        assert.match(failure.message, line, code);
      }
    });
  } finally {
    await server.stop();
  }
});

test("reading the hall is tier none; naming yourself in it is medium", () => {
  assert.equal(actOf(parseArgs(["wallet", "hall"])), "wallet.hall");
  assert.equal(actOf(parseArgs(["wallet", "hall", "--name", "alice"])), "wallet.hall.set");
  assert.equal(actOf(parseArgs(["wallet", "hall", "--remove"])), "wallet.hall.set");
  assert.equal(ACTS["wallet.hall"].tier, "none");
  assert.equal(ACTS["wallet.hall.set"].tier, "medium");
});

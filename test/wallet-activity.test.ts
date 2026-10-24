// `nmts wallet activity` — the list is the browser's judgement over the chain's answer, and an
// unanswered chain is never an empty list.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { activityContext, walletActivity, type ActivityFetch } from "../src/commands/wallet-activity.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { ChainTransaction } from "../src/shared/lib/wallet/activity.ts";
import { walletAddress } from "../src/wallet.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function withAccount(name: string, body: (code: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

const OTHER = "0x" + "22".repeat(32);
const DIGEST_EXTEND = "9eXtEnD" + "a".repeat(37);
const DIGEST_RECEIVE = "9rEcEiVe" + "b".repeat(36);

/** An extension signed by `me`, and a transfer in from somebody else. */
function twoTransactions(me: string): ActivityFetch {
  const ctx = activityContext("testnet", me);
  // The shape the SDK's gRPC parser gives (`parseGrpcTransactionResponse`): the time as a number,
  // status as `{ success }`, a balance change's `address`, and inputs/commands under `transaction`.
  const extend: ChainTransaction = {
    digest: DIGEST_EXTEND,
    timestampMs: 1788566400000,
    status: { success: true },
    balanceChanges: [{ address: me, coinType: ctx.walCoinType, amount: "-1250000000" }],
    transaction: {
      sender: me,
      gasData: { owner: me },
      inputs: [
        { $kind: "Object", Object: { $kind: "SharedObject", SharedObject: { objectId: ctx.walrusSystemObjectId } } },
      ],
      commands: [{ $kind: "MoveCall", MoveCall: { package: "0x1", module: "system", function: "extend_blob" } }],
    },
  };
  const receive: ChainTransaction = {
    digest: DIGEST_RECEIVE,
    timestampMs: 1788652800000,
    status: { success: true },
    balanceChanges: [
      { address: OTHER, coinType: "0x2::sui::SUI", amount: "-500000000" },
      { address: me, coinType: "0x2::sui::SUI", amount: "500000000" },
    ],
    transaction: { sender: OTHER, gasData: { owner: OTHER }, inputs: [], commands: [] },
  };
  // A node may list the same transaction twice across pages (a cursor that moved under a new
  // checkpoint), so the merge must not print it twice.
  return { transactions: [receive, extend, extend] };
}

test("the rows carry the browser's names, newest first, without a duplicate for a transaction listed twice", async () => {
  await withAccount("wallet-activity-rows", async (code) => {
    const me = await walletAddress(code);
    const out = collect();
    const asked: string[] = [];
    const rc = await walletActivity({
      network: "testnet",
      write: out.write,
      queryChain: async (network, address) => {
        asked.push(`${network} ${address}`);
        return twoTransactions(me);
      },
    });
    assert.equal(rc, 0);
    assert.deepEqual(asked, [`testnet ${me}`]);
    const text = out.lines.join("\n");
    assert.match(text, /2026-09-06T00:00:00Z {2}receive {3}\+0\.5 SUI/);
    assert.match(text, /2026-09-05T00:00:00Z {2}extend {4}-1\.25 WAL/);
    assert.equal(text.split(DIGEST_EXTEND).length - 1, 1, "the extension was printed twice");
    assert.ok(text.indexOf(DIGEST_RECEIVE) < text.indexOf(DIGEST_EXTEND), "newest first");
    assert.match(text, /Gifts to the developer show here as sends/);
  });
});

test("--json says the same rows with base units as strings", async () => {
  await withAccount("wallet-activity-json", async (code) => {
    const me = await walletAddress(code);
    const out = collect();
    assert.equal(
      await walletActivity({ network: "testnet", json: true, write: out.write, queryChain: async () => twoTransactions(me) }),
      0,
    );
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const rows: unknown = Reflect.get(parsed, "rows");
    assert.ok(Array.isArray(rows) && rows.length === 2);
    const first: unknown = rows[0];
    assert.ok(typeof first === "object" && first !== null);
    assert.equal(Reflect.get(first, "kind"), "receive");
    const changes: unknown = Reflect.get(first, "changes");
    assert.ok(Array.isArray(changes));
    assert.deepEqual(changes[0], { coin: "SUI", coinType: "0x2::sui::SUI", baseUnits: "500000000", amount: "+0.5" });
    assert.match(String(Reflect.get(first, "explorerUrl")), /suiscan\.xyz\/testnet\/tx\//);
  });
});

test("⛔ a chain that did not answer is a refusal with a cause, never an empty list", async () => {
  await withAccount("wallet-activity-down", async () => {
    const out = collect();
    const failure = await walletActivity({
      network: "testnet",
      write: out.write,
      queryChain: async () => {
        throw new Error("the node timed out");
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 1);
    assert.match(String(failure.nextStep), /not the same as there being none/);
    assert.match(String(failure.nextStep), /the node timed out/);
    assert.doesNotMatch(out.lines.join("\n"), /lists no transaction/);
  });
});

test("⛔ a history read only to the node's window never says the wallet has no transaction", async () => {
  await withAccount("wallet-activity-partial", async (code) => {
    const me = await walletAddress(code);
    const empty = collect();
    assert.equal(
      await walletActivity({
        network: "testnet",
        write: empty.write,
        queryChain: async () => ({ transactions: [], complete: false }),
      }),
      0,
    );
    const emptyText = empty.lines.join("\n");
    assert.doesNotMatch(emptyText, /lists no transaction/);
    assert.match(emptyText, /older history could not be read/);

    const some = collect();
    assert.equal(
      await walletActivity({
        network: "testnet",
        write: some.write,
        queryChain: async () => ({ ...twoTransactions(me), complete: false }),
      }),
      0,
    );
    assert.match(some.lines.join("\n"), /more than a few weeks\s+ago may be missing/);

    const json = collect();
    await walletActivity({
      network: "testnet",
      json: true,
      write: json.write,
      queryChain: async () => ({ transactions: [], complete: false }),
    });
    const parsed: unknown = JSON.parse(json.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(parsed, "complete"), false);
  });
});

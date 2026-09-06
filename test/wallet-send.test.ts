// `nmts wallet send` — the review comes before the signature, the browser's rules judge the
// address and the amount, an unread balance is not zero, and the wallet agreement's scope and
// ceiling are held against the transfer.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { walletSend } from "../src/commands/wallet-send.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { WalletBalances } from "../src/wallet.ts";
import { parseWalletGrant, readWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import type { SendReads, TransferShape } from "../src/wallet-send-chain.ts";
import type { SignTransfer } from "../src/wallet-sign.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

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
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

const TO = "0x" + "ab".repeat(32);
const AT = Date.UTC(2026, 8, 5);

function reads(over: { sui?: bigint | null; wal?: bigint | null; fee?: bigint | null } = {}): SendReads & { estimated: TransferShape[] } {
  const estimated: TransferShape[] = [];
  const coin = (held: bigint | null | undefined, plenty: bigint): WalletBalances["sui"] =>
    held === null ? { read: false, why: "the node did not answer" } : { read: true, baseUnits: held ?? plenty };
  return {
    estimated,
    async readWallet() {
      return { sui: coin(over.sui, 1_000_000_000n), wal: coin(over.wal, 5_000_000_000n) };
    },
    async estimateFee(shape) {
      estimated.push(shape);
      return over.fee === undefined ? 2_000_000n : over.fee;
    },
  };
}

function refuseToSign(): SignTransfer & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error("it signed");
  };
  sign.calls = 0;
  return sign;
}

function recordingSigner(): SignTransfer & { asked: TransferShape[] } {
  const asked: TransferShape[] = [];
  const sign = async (input: { shape: TransferShape }): Promise<string> => {
    asked.push(input.shape);
    return "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz";
  };
  sign.asked = asked;
  return sign;
}

async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

test("⛔ without --yes the review is printed, with the whole address and the fee, and nothing is signed", async () => {
  await withAccount("wallet-send-review", async () => {
    const out = collect();
    const sign = refuseToSign();
    const chain = reads();
    const failure = await refusal(walletSend(["WAL", "1.5", TO], { network: "testnet", write: out.write, readChain: () => chain, sign, now: AT }));
    assert.equal(failure.exitCode, 4);
    assert.match(String(failure.nextStep), /--yes/);
    const text = out.lines.join("\n");
    assert.match(text, /^Sending 1\.5 WAL$/m);
    assert.match(text, new RegExp(`to {4}${TO}`));
    assert.match(text, /Chain fee about 0\.002 SUI, measured by a dry run/);
    assert.match(text, /holds about 0\.998 SUI and 3\.5 WAL/);
    assert.match(text, /cannot be undone/);
    assert.equal(sign.calls, 0);
    assert.deepEqual(chain.estimated.map((s) => [s.coin, s.amountBaseUnits, s.destination]), [["WAL", 1_500_000_000n, TO]]);
  });
});

test("⛔ the browser's rules judge the address and the amount, and an unread balance stops the run as unread", async () => {
  await withAccount("wallet-send-rules", async () => {
    const quiet = { write: () => undefined, network: "testnet", sign: refuseToSign(), now: AT };
    assert.equal((await refusal(walletSend(["SUI", "1", "0x1234"], { ...quiet, readChain: () => reads() }))).exitCode, 2);
    assert.equal((await refusal(walletSend(["SUI", "0", TO], { ...quiet, readChain: () => reads() }))).exitCode, 2);
    const short = await refusal(walletSend(["SUI", "0.99", TO], { ...quiet, readChain: () => reads() }));
    assert.equal(short.exitCode, 4, "0.99 of 1 SUI passes the reserve — refused, not signed");
    assert.match(String(short.nextStep), /most that can be sent is 0\.95 SUI/);
    const gas = await refusal(walletSend(["WAL", "1", TO], { ...quiet, readChain: () => reads({ sui: 1_000n }) }));
    assert.match(gas.message, /pays its fee in SUI/);
    const unread = await refusal(walletSend(["WAL", "1", TO], { ...quiet, readChain: () => reads({ wal: null }) }));
    assert.equal(unread.exitCode, 1);
    assert.match(String(unread.nextStep), /not an empty wallet — WAL: the node did not answer/);
    assert.equal((await refusal(walletSend(["BTC", "1", TO], { ...quiet, readChain: () => reads() }))).exitCode, 2);
  });
});

test("⛔ --yes still needs a wallet agreement with scope all, and the ceiling counts the fee", async () => {
  await withAccount("wallet-send-grant", async () => {
    const quiet = { write: () => undefined, network: "testnet", yes: true, readChain: () => reads(), now: AT };
    const none = await refusal(walletSend(["SUI", "0.1", TO], { ...quiet, sign: refuseToSign() }));
    assert.equal(none.exitCode, 5);
    writeWalletGrant(parseWalletGrant({ days: "7" }, new Date(AT), "t"));
    const storageOnly = await refusal(walletSend(["SUI", "0.1", TO], { ...quiet, sign: refuseToSign() }));
    assert.equal(storageOnly.exitCode, 5);
    assert.match(storageOnly.message, /covers storage only, and this would send/);
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all", capSui: "0.1" }, new Date(AT), "t"));
    const capped = await refusal(walletSend(["SUI", "0.1", TO], { ...quiet, sign: refuseToSign() }));
    assert.match(capped.message, /0\.102 SUI in fees .* 0\.1 SUI left/);
  });
});

test("with --yes and an agreement, the signed shape is what was reviewed, max keeps the SUI reserve, and the ledger grows", async () => {
  await withAccount("wallet-send-signs", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, new Date(AT), "t"));
    const sign = recordingSigner();
    const out = collect();
    assert.equal(
      await walletSend(["sui", "max", TO.toUpperCase()], { network: "testnet", yes: true, feeCap: "0.5", write: out.write, readChain: () => reads(), sign, now: AT }),
      0,
    );
    assert.deepEqual(sign.asked, [
      { coin: "SUI", amountBaseUnits: 950_000_000n, destination: TO, walType: sign.asked[0]?.walType, gasBudgetMist: 500_000_000n },
    ]);
    assert.match(out.lines.join("\n"), /Sent\. Transaction 3nJqYd2f/);
    assert.match(out.lines.join("\n"), /suiscan\.xyz\/testnet\/tx\//);
    assert.equal(readWalletGrant()?.spentSuiMist, (950_000_000n + 2_000_000n).toString());

    const json = collect();
    assert.equal(
      await walletSend(["WAL", "2", TO], { network: "testnet", yes: true, json: true, write: json.write, readChain: () => reads(), sign, now: AT }),
      0,
    );
    const parsed: unknown = JSON.parse(json.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(parsed, "amountBaseUnits"), "2000000000");
    assert.equal(Reflect.get(parsed, "signed"), true);
    assert.equal(readWalletGrant()?.spentWalFrost, "2000000000");
  });
});

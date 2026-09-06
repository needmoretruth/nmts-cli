// `nmts wallet swap` — the review comes before the signature, both venues are quoted when none is
// chosen and the run stops there, the slippage arithmetic is the browser's, an extreme quote is
// refused, a storage-only agreement is refused, and --yes signs the reviewed shape and grows the
// ledger. ⛔ No chain, no wallet, no money: every read and the signature go through seams.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { setMode } from "../src/autonomy.ts";
import { walletSwap } from "../src/commands/wallet-swap.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { minOutFromQuote, SLIPPAGE_BPS_DEFAULT } from "../src/shared/lib/wallet/swap-rules.ts";
import { parseWalletGrant, readWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import type { SwapReads, SwapShape } from "../src/wallet-swap-chain.ts";
import type { SignSwap } from "../src/wallet-sign.ts";
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

const AT = Date.UTC(2026, 8, 5);
const BINDING = { packageId: "0x" + "d0".repeat(32), globalConfigId: "0x" + "03".repeat(32), poolId: "0x" + "e6".repeat(32) };
/** 1 SUI buys 27.5 WAL on DeepBook and 27.53 on Bluefin — the shape of the 2026-08-03 measurements. */
const OUT = { deepbook: 27_500_000_000n, bluefin: 27_530_000_000n };

function reads(over: { deepbook?: bigint | null; bluefin?: bigint | null; fee?: bigint | null; sui?: bigint } = {}): SwapReads & { estimated: SwapShape[] } {
  const estimated: SwapShape[] = [];
  return {
    estimated,
    async readWallet() {
      return { sui: { read: true, baseUnits: over.sui ?? 5_000_000_000n }, wal: { read: true, baseUnits: 100_000_000_000n } };
    },
    async resolveBluefin() {
      return BINDING;
    },
    async readExchange() {
      throw new Error("no facility on mainnet");
    },
    async quote(venue, direction, amountInUnits) {
      const per = venue === "deepbook" ? over.deepbook : over.bluefin;
      if (per === null) throw new Error(`${venue} is silent`);
      const rate = per ?? OUT[venue];
      // Proportional to the amount, either way round: 27.5 WAL per SUI, 1/27.5 SUI per WAL.
      const outUnits = direction === "SUI_TO_WAL" ? (amountInUnits * rate) / 1_000_000_000n : (amountInUnits * 1_000_000_000n) / rate;
      return { venue, outUnits, feeRateBps: venue === "deepbook" ? 12.7 : 20, leftoverInUnits: venue === "deepbook" ? 3_000_000n : 0n };
    },
    async estimateFee(shape) {
      estimated.push(shape);
      return over.fee === undefined ? 2_100_000n : over.fee;
    },
  };
}

/** SUI at $3.30 and WAL at $0.12 make the market 27.5 WAL per SUI — on the quote. */
const PRICES = async () => ({ suiUsd: 3.3, walUsd: 0.12 });

function refuseToSign(): SignSwap & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error("it signed");
  };
  sign.calls = 0;
  return sign;
}

function recordingSigner(): SignSwap & { asked: SwapShape[] } {
  const asked: SwapShape[] = [];
  const sign = async (input: { shape: SwapShape }): Promise<string> => {
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

test("⛔ without --venue both venues are quoted side by side and the run stops: neither is a default", async () => {
  await withAccount("wallet-swap-both", async () => {
    const out = collect();
    const sign = refuseToSign();
    const chain = reads();
    const failure = await refusal(walletSwap(["SUI", "1"], { network: "mainnet", write: out.write, readChain: () => chain, readPrices: PRICES, sign }));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /recommends neither/);
    assert.match(String(failure.nextStep), /--venue deepbook or --venue bluefin/);
    const text = out.lines.join("\n");
    assert.match(text, /^Quotes for 1 SUI → WAL/m);
    assert.match(text, /deepbook {2}27\.5 WAL — venue fee about 0\.13%.*0\.003 SUI would come back unused/);
    assert.match(text, /bluefin {3}27\.53 WAL — venue fee about 0\.2%/);
    assert.equal(sign.calls, 0);
    assert.equal(chain.estimated.length, 0, "no fee is measured before a venue is chosen");

    // One venue silent: its row says so, and the run still stops rather than picking the other.
    const quiet = collect();
    const half = await refusal(walletSwap(["SUI", "1"], { network: "mainnet", write: quiet.write, readChain: () => reads({ bluefin: null }), readPrices: PRICES, sign }));
    assert.equal(half.exitCode, 4);
    assert.match(quiet.lines.join("\n"), /bluefin {3}did not answer — bluefin is silent/);
  });
});

test("⛔ with --venue the review is printed — quote, minimum from the shared arithmetic, fees, market check — and nothing is signed without --yes", async () => {
  await withAccount("wallet-swap-review", async () => {
    const out = collect();
    const sign = refuseToSign();
    const chain = reads();
    const failure = await refusal(walletSwap(["SUI", "1"], { network: "mainnet", venue: "bluefin", feeCap: "0.01", write: out.write, readChain: () => chain, readPrices: PRICES, sign }));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /needs --yes/);
    const text = out.lines.join("\n");
    assert.match(text, /^Swapping 1 SUI for WAL on Bluefin$/m);
    assert.match(text, /Quoted {4}27\.53 WAL — the chain's answer just now, not a promise/);
    const expectedMin = minOutFromQuote(OUT.bluefin, SLIPPAGE_BPS_DEFAULT);
    assert.equal(expectedMin, 27_392_350_000n);
    assert.match(text, /At least {2}27\.39235 WAL, or the swap fails on chain — slippage 50 bps \(0\.5%\)/);
    assert.match(text, /Venue fee about 0\.2% of what goes in/);
    assert.match(text, /Chain fee about 0\.0021 SUI, measured by a dry run/);
    assert.match(text, /Fee cap {3}0\.01 SUI/);
    assert.match(text, /Market {4}0\.11% from the site's reference price/);
    assert.match(text, /not a party to this trade and takes nothing from it/);
    assert.doesNotMatch(text, /Outside the ordinary bands/);
    assert.equal(sign.calls, 0);
    assert.equal(chain.estimated.length, 1);
    assert.equal(chain.estimated[0]?.minOutUnits, expectedMin);
    assert.deepEqual(chain.estimated[0]?.bluefin, BINDING);

    // --slippage-bps reaches the same arithmetic; a non-number is refused before any read.
    const loose = collect();
    await refusal(walletSwap(["SUI", "1"], { network: "mainnet", venue: "deepbook", slippageBps: "100", write: loose.write, readChain: () => reads(), readPrices: PRICES, sign }));
    assert.match(loose.lines.join("\n"), /At least {2}27\.225 WAL, or the swap fails on chain — slippage 100 bps \(1%\)/);
    assert.equal((await refusal(walletSwap(["SUI", "1"], { network: "mainnet", venue: "deepbook", slippageBps: "lots", write: () => undefined, readChain: () => reads(), sign }))).exitCode, 2);

    // No reference price: said as uncompared, never as fine.
    const blind = collect();
    await refusal(walletSwap(["WAL", "10"], { network: "mainnet", venue: "deepbook", write: blind.write, readChain: () => reads(), readPrices: async () => null, sign }));
    assert.match(blind.lines.join("\n"), /Market {4}no reference price could be read just now, so the quote was not compared/);
  });
});

test("⛔ an extreme is refused even with --yes; --accept-extremes is a person's act", async () => {
  await withAccount("wallet-swap-extremes", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, new Date(AT), "t"));
    const sign = refuseToSign();
    const base = { network: "mainnet", venue: "deepbook", yes: true, readChain: () => reads(), sign, now: AT };
    // The market says 27.5 WAL per SUI and the quote says 27.5 — but the reference price moved 10%.
    const far = collect();
    const deviation = await refusal(walletSwap(["SUI", "1"], { ...base, write: far.write, readPrices: async () => ({ suiUsd: 3.3, walUsd: 0.1 }) }));
    assert.equal(deviation.exitCode, 4);
    assert.match(deviation.message, /outside the ordinary bands/);
    assert.match(far.lines.join("\n"), /more than 3% from the site's reference price/);
    // Slippage under 10 bps, from the shared band.
    const tight = await refusal(walletSwap(["SUI", "1"], { ...base, slippageBps: "5", write: () => undefined, readPrices: PRICES }));
    assert.equal(tight.exitCode, 4);
    assert.match(String(tight.nextStep), /--accept-extremes/);
    assert.equal(sign.calls, 0);
    // A mode is on: the person's say is not a program's to give.
    setMode("auto-low", "t", new Date(AT));
    try {
      const auto = await refusal(walletSwap(["SUI", "1"], { ...base, slippageBps: "5", acceptExtremes: true, write: () => undefined, readPrices: PRICES }));
      assert.equal(auto.exitCode, 5);
      assert.match(auto.message, /person's act/);
    } finally {
      setMode("default", "t", new Date(AT));
    }
    assert.equal(sign.calls, 0);
  });
});

test("⛔ --yes still needs a wallet agreement with scope all", async () => {
  await withAccount("wallet-swap-grant", async () => {
    const quiet = { write: () => undefined, network: "mainnet", venue: "deepbook", yes: true, readChain: () => reads(), readPrices: PRICES, now: AT };
    assert.equal((await refusal(walletSwap(["SUI", "1"], { ...quiet, sign: refuseToSign() }))).exitCode, 5);
    writeWalletGrant(parseWalletGrant({ days: "7" }, new Date(AT), "t"));
    const storageOnly = await refusal(walletSwap(["SUI", "1"], { ...quiet, sign: refuseToSign() }));
    assert.equal(storageOnly.exitCode, 5);
    assert.match(storageOnly.message, /covers storage only, and this would exchange/);
  });
});

test("with --yes and an agreement, the signed shape is what was reviewed, max keeps the fee back, and the ledger grows", async () => {
  await withAccount("wallet-swap-signs", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, new Date(AT), "t"));
    const sign = recordingSigner();
    const out = collect();
    // A fee cap of 0.004 SUI against a measured 0.0021: inside the ordinary band, so no gate.
    assert.equal(
      await walletSwap(["sui", "max"], { network: "mainnet", venue: "deepbook", yes: true, feeCap: "0.004", write: out.write, readChain: () => reads({ sui: 1_000_000_000n }), readPrices: PRICES, sign, now: AT }),
      0,
    );
    const asked = sign.asked[0];
    assert.ok(asked !== undefined);
    assert.equal(asked.venue, "deepbook");
    assert.equal(asked.direction, "SUI_TO_WAL");
    assert.equal(asked.amountInUnits, 996_000_000n, "1 SUI minus the 0.004 SUI fee cap");
    assert.equal(asked.minOutUnits, minOutFromQuote((996_000_000n * OUT.deepbook) / 1_000_000_000n, SLIPPAGE_BPS_DEFAULT));
    assert.equal(asked.gasBudgetMist, 4_000_000n);
    assert.match(out.lines.join("\n"), /Swapped\. Transaction 3nJqYd2f/);
    assert.match(out.lines.join("\n"), /suiscan\.xyz\/mainnet\/tx\//);
    assert.equal(readWalletGrant()?.spentSuiMist, (996_000_000n + 2_100_000n).toString());

    const json = collect();
    assert.equal(
      await walletSwap(["WAL", "10"], { network: "mainnet", venue: "bluefin", to: "sui", yes: true, json: true, write: json.write, readChain: () => reads(), readPrices: PRICES, sign, now: AT }),
      0,
    );
    const parsed: unknown = JSON.parse(json.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(parsed, "amountInUnits"), "10000000000");
    assert.equal(Reflect.get(parsed, "signed"), true);
    assert.equal(Reflect.get(parsed, "venueFeeBps"), 20);
    assert.equal(readWalletGrant()?.spentWalFrost, "10000000000");
    assert.equal((await refusal(walletSwap(["WAL", "1"], { network: "mainnet", venue: "bluefin", to: "WAL", write: () => undefined, readChain: () => reads(), sign }))).exitCode, 2);
  });
});

test("on testnet the rail is the official facility: SUI→WAL only, no venue, no slippage, and its rate is read, not assumed", async () => {
  await withAccount("wallet-swap-testnet", async () => {
    const chain: SwapReads = {
      ...reads(),
      async readExchange() {
        return { objectId: "0x" + "ee".repeat(32), packageId: "0x" + "ab".repeat(32), rateWal: 1n, rateSui: 1n };
      },
    };
    const sign = refuseToSign();
    const out = collect();
    const failure = await refusal(walletSwap(["SUI", "0.5"], { network: "testnet", write: out.write, readChain: () => chain, readPrices: async () => null, sign }));
    assert.equal(failure.exitCode, 4);
    const text = out.lines.join("\n");
    assert.match(text, /on the official Walrus testnet exchange/);
    assert.match(text, /Quoted {4}0\.5 WAL/);
    assert.match(text, /Rate {6}1 WAL per 1 SUI, read off the facility/);
    assert.equal((await refusal(walletSwap(["WAL", "1"], { network: "testnet", write: () => undefined, readChain: () => chain, sign }))).exitCode, 2);
    assert.equal((await refusal(walletSwap(["SUI", "1"], { network: "testnet", venue: "deepbook", write: () => undefined, readChain: () => chain, sign }))).exitCode, 2);
    const unread = await refusal(walletSwap(["SUI", "1"], { network: "testnet", write: () => undefined, readChain: () => reads(), sign }));
    assert.equal(unread.exitCode, 1);
    assert.match(unread.message, /could not be read, so what it would give is unknown/);
    assert.equal(sign.calls, 0);
  });
});

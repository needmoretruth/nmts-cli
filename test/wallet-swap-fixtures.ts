// What the `nmts wallet swap` tests share: an account in a throwaway config folder, the chain reads
// as a seam (balances, quotes, the fee dry run), and signers that record or refuse. ⛔ No chain, no
// wallet, no money: every read and the signature go through seams.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";

import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import type { SwapReads, SwapShape } from "../src/wallet-swap-chain.ts";
import type { SignSwap } from "../src/wallet-sign.ts";
import { generateCode, grantConsents } from "./helpers.ts";

export function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

export async function withAccount(name: string, body: (code: string) => Promise<void>): Promise<void> {
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

export const AT = Date.UTC(2026, 8, 5);
/**
 * ⚠ THESE TESTS CANNOT REACH THE SEALED FILE LIST (there is no server). The default reads the
 *   swapping wallet's number out of that list (`wallet-pay-index.ts`), so here it is pinned to the
 *   first wallet — except in the two tests below that are about the number itself.
 */
export const FIRST_WALLET = { readActiveWallet: async (): Promise<number> => 0 };
export const BINDING = {
  packageId: "0x" + "d0".repeat(32),
  globalConfigId: "0x" + "03".repeat(32),
  pools: { WAL_SUI: "0x" + "e6".repeat(32), SUI_USDC: "0x" + "e7".repeat(32), WAL_USDC: "0x" + "e8".repeat(32) },
};
/** 1 SUI buys 27.5 WAL on DeepBook and 27.53 on Bluefin — the shape of the 2026-08-03 measurements. */
export const OUT = { deepbook: 27_500_000_000n, bluefin: 27_530_000_000n };

export function reads(over: { deepbook?: bigint | null; bluefin?: bigint | null; fee?: bigint | null; sui?: bigint } = {}): SwapReads & { estimated: SwapShape[] } {
  const estimated: SwapShape[] = [];
  return {
    estimated,
    async readWallet() {
      return { sui: { read: true, baseUnits: over.sui ?? 5_000_000_000n }, wal: { read: true, baseUnits: 100_000_000_000n } };
    },
    async readUsdc() {
      return { read: true, baseUnits: 12_000_000n };
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
      return { venue, outUnits, feeRateBps: venue === "deepbook" ? 12.7 : 20, leftoverInUnits: venue === "deepbook" ? 3_000_000n : 0n, route: "direct", leftoverMidUnits: 0n };
    },
    async estimateFee(shape) {
      estimated.push(shape);
      return over.fee === undefined ? 2_100_000n : over.fee;
    },
  };
}

/** SUI at $3.30 and WAL at $0.12 make the market 27.5 WAL per SUI — on the quote. */
export const PRICES = async () => ({ suiUsd: 3.3, walUsd: 0.12 });

export function refuseToSign(): SignSwap & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error("it signed");
  };
  sign.calls = 0;
  return sign;
}

export function recordingSigner(): SignSwap & { asked: SwapShape[]; wallets: number[] } {
  const asked: SwapShape[] = [];
  // Which wallet was asked to sign, run by run — the half of this seam that no shape can show.
  const wallets: number[] = [];
  const sign = async (input: { wallet: number; shape: SwapShape }): Promise<string> => {
    asked.push(input.shape);
    wallets.push(input.wallet);
    return "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz";
  };
  sign.asked = asked;
  sign.wallets = wallets;
  return sign;
}

export async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

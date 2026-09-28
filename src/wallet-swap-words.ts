// The words and figures `nmts wallet swap` prints and parses: which coin a word names (a symbol, or a
// full coin type matched EXACTLY — a coin that only shares the name "USDC" is refused), an amount in
// its own coin's decimals, a quote line, and the site's reference prices. Nothing here reads a chain,
// signs, or decides whether to swap; `commands/wallet-swap.ts` does that, in its fixed order.

import { NmtsError } from "./errors.ts";
import { isRecord } from "./guards.ts";
import type { Network } from "./network.ts";
import { BINARY_NAME } from "./product.ts";
import { COIN_DECIMALS, swapCoinOfType, type SwapCoin, type SwapExtreme, type SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
import { coinAmount } from "./wallet.ts";
import { swapCoinTypes, type VenueQuote } from "./wallet-swap-quote.ts";

/** What the site's price route says, when it says anything. Null = no reference price just now. */
export interface MarketPrices {
  suiUsd: number | null;
  walUsd: number | null;
  /** Absent from an older site; then the USDC directions are "uncompared", never assumed at 1. */
  usdcUsd?: number | null;
}

export const EXTREME_WORDS: Record<SwapExtreme, string> = {
  lowSlippage: "the slippage is below 10 bps: the smallest price movement fails the swap, and the chain fee is spent for nothing",
  highSlippage: "the slippage is above 200 bps: a thin order book may keep that much of what goes in",
  lowFee: "the fee cap is under 1.2 times the measured fee: the swap may fail for want of gas, and that gas is gone",
  highFee: "the fee cap is over ten times the measured fee and over 0.05 SUI",
  deviation: "the quote is more than 3% from the site's reference price: the book may be thin or moved",
};

export const USAGE = `\`${BINARY_NAME} wallet swap <SUI|WAL|USDC> <amount|max> --to <SUI|WAL|USDC> --venue deepbook|bluefin\``;

/**
 * A coin named on the command line: a symbol, or a full coin type. A symbol answers at once; a full
 * type is kept as written and matched against the network's exact types once the network is known.
 */
export type CoinWord = { coin: SwapCoin } | { coinType: string };

export function coinWordOf(raw: string | undefined, what: string): CoinWord {
  const text = (raw ?? "").trim();
  const up = text.toUpperCase();
  if (up === "SUI" || up === "WAL" || up === "USDC") return { coin: up };
  if (text.includes("::")) return { coinType: text };
  throw new NmtsError(`Say which coin ${what}: SUI, WAL or USDC.`, { exitCode: 2, nextStep: USAGE });
}

/** The coin a word names on this network. ⛔ A full type must equal one of the three EXACT types. */
export function resolveCoin(word: CoinWord, network: Network): SwapCoin {
  if ("coin" in word) return word.coin;
  const coin = swapCoinOfType(word.coinType, swapCoinTypes(network));
  if (coin === null) {
    throw new NmtsError(`${word.coinType} is not SUI, WAL or Circle's native USDC on ${network}.`, {
      exitCode: 2,
      nextStep: `Nothing was signed. A coin is matched by its whole type, package address included — a coin that only shares the name is a different coin. The USDC this tool swaps is ${swapCoinTypes(network).USDC}.`,
    });
  }
  return coin;
}

/** An amount of one coin, exactly, in that coin's own decimals (USDC keeps 6, SUI and WAL 9). */
export function amountOf(coin: SwapCoin, units: bigint): string {
  const decimals = COIN_DECIMALS[coin];
  if (decimals === 9) return coinAmount(units);
  const scale = 10n ** BigInt(decimals);
  const fraction = units % scale;
  if (fraction === 0n) return (units / scale).toString();
  return `${units / scale}.${fraction.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

export function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function asMarketPrices(value: unknown): MarketPrices | null {
  if (!isRecord(value) || value["unavailable"] === true) return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return { suiUsd: num(value["suiUsd"]), walUsd: num(value["walUsd"]), usdcUsd: num(value["usdcUsd"]) };
}

export function venueName(venue: SwapVenue | "exchange"): string {
  return venue === "deepbook" ? "DeepBook" : venue === "bluefin" ? "Bluefin" : "the official Walrus testnet exchange";
}

export function quoteLine(q: VenueQuote, outCoin: SwapCoin, inCoin: SwapCoin): string {
  const fee = q.feeRateBps === null ? "venue fee could not be measured" : `venue fee about ${pct(q.feeRateBps)}`;
  const via = q.route === "viaUsdc" ? ` — ${inCoin} → USDC → ${outCoin} in one transaction` : "";
  const left = q.leftoverInUnits > 0n ? ` (${amountOf(inCoin, q.leftoverInUnits)} ${inCoin} would come back unused)` : "";
  const mid = q.leftoverMidUnits > 0n ? ` (${amountOf("USDC", q.leftoverMidUnits)} USDC would come back unused)` : "";
  return `${q.venue.padEnd(9)} ${amountOf(outCoin, q.outUnits)} ${outCoin} — ${fee}${via}${left}${mid}`;
}

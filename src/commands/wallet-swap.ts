// `nmts wallet swap <SUI|WAL> <amount|max>` — turn one coin into the other, from the wallet this
// account code derives, on the venue the person names. ⛔ SIGNS AND SPENDS.
//
// ⛔ THE ORDER IS THE SAFETY. ① both balances are READ, and an unread one stops the run ② the
//    amount and the slippage are judged by the browser's own rules (`shared/lib/wallet/swap-rules.ts`,
//    copied byte-for-byte) ③ the venue's quote is read from the chain — on mainnet BOTH venues when
//    none was named, printed side by side, and the run stops there: neither is a default and nobody
//    recommends one ④ the exact swap is dry-run for its fee ⑤ the quote is compared with the site's
//    reference price when one can be read, and said to be uncompared when none can ⑥ the review is
//    printed ⑦ anything outside the ordinary bands — slippage, fee cap, market distance — is refused;
//    only a person, in mode off, may say `--accept-extremes` ⑧ without `--yes` that is the end ⑨ the
//    wallet agreement is held against the amount and the fee, scope `all` ⑩ only then the signature.
//
// ⛔ NOT ON THE MCP SURFACE. A model can ask a person to run this; it cannot run it through a tool call.

import { request } from "../api.ts";
import { currentMode } from "../autonomy.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { isRecord } from "../guards.ts";
import { resolveNetwork, type Network } from "../network.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import { explorerTxUrl } from "../shared/lib/wallet/activity.ts";
import { clampGasBudgetMist, parseTokenAmountToBaseUnits, SUI_GAS_RESERVE_MIST } from "../shared/lib/wallet/send-rules.ts";
import {
  clampSlippageBps,
  impliedRate,
  marketRate,
  maxSwappableSuiMist,
  minOutFromQuote,
  priceDeviationBps,
  SLIPPAGE_BPS_DEFAULT,
  SLIPPAGE_BPS_MAX,
  SLIPPAGE_BPS_MIN,
  swapExtremes,
  type SwapDirection,
  type SwapExtreme,
  type SwapVenue,
} from "../shared/lib/wallet/swap-rules.ts";
import { coinAmount, walletAddress } from "../wallet.ts";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.ts";
import { railsFor, type BluefinBinding, type SwapReads, type SwapShape } from "../wallet-swap-chain.ts";
import type { VenueQuote } from "../wallet-swap-quote.ts";
import type { SignSwap } from "../wallet-sign.ts";

/** What the site's price route says, when it says anything. Null = no reference price just now. */
export interface MarketPrices {
  suiUsd: number | null;
  walUsd: number | null;
}

export interface WalletSwapOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  yes?: boolean;
  dryRun?: boolean;
  feeCap?: string | undefined;
  /** `--to`: the coin to receive. Only ever the other coin; said so a typo cannot flip the trade. */
  to?: string | undefined;
  /** `--venue`: deepbook or bluefin. Without it, both are quoted and the run stops. */
  venue?: string | undefined;
  /** `--slippage-bps`: whole bps, clamped to the browser's range. Default 50. */
  slippageBps?: string | undefined;
  /** `--accept-extremes`: go on past the extremes gate. A person's act — refused outside mode off. */
  acceptExtremes?: boolean;
  now?: number;
  /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
  readChain?: (network: Network) => SwapReads | Promise<SwapReads>;
  readPrices?: (server: string) => Promise<MarketPrices | null>;
  sign?: SignSwap;
}

const EXTREME_WORDS: Record<SwapExtreme, string> = {
  lowSlippage: "the slippage is below 10 bps: the smallest price movement fails the swap, and the chain fee is spent for nothing",
  highSlippage: "the slippage is above 200 bps: a thin order book may keep that much of what goes in",
  lowFee: "the fee cap is under 1.2 times the measured fee: the swap may fail for want of gas, and that gas is gone",
  highFee: "the fee cap is over ten times the measured fee and over 0.05 SUI",
  deviation: "the quote is more than 3% from the site's reference price: the book may be thin or moved",
};

function coinOf(raw: string | undefined, what: string): "SUI" | "WAL" {
  const up = (raw ?? "").toUpperCase();
  if (up === "SUI" || up === "WAL") return up;
  throw new NmtsError(`Say which coin ${what}: SUI or WAL.`, {
    exitCode: 2,
    nextStep: `\`${BINARY_NAME} wallet swap <SUI|WAL> <amount|max> --venue deepbook|bluefin\``,
  });
}

function pct(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function asMarketPrices(value: unknown): MarketPrices | null {
  if (!isRecord(value) || value["unavailable"] === true) return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return { suiUsd: num(value["suiUsd"]), walUsd: num(value["walUsd"]) };
}

function venueName(venue: SwapVenue | "exchange"): string {
  return venue === "deepbook" ? "DeepBook" : venue === "bluefin" ? "Bluefin" : "the official Walrus testnet exchange";
}

function quoteLine(q: VenueQuote, outCoin: string, inCoin: string): string {
  const fee = q.feeRateBps === null ? "venue fee could not be measured" : `venue fee about ${pct(q.feeRateBps)}`;
  const left = q.leftoverInUnits > 0n ? ` (${coinAmount(q.leftoverInUnits)} ${inCoin} would come back unused)` : "";
  return `${q.venue.padEnd(9)} ${coinAmount(q.outUnits)} ${outCoin} — ${fee}${left}`;
}

export async function walletSwap(operands: readonly string[], options: WalletSwapOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const [coinRaw, amountRaw] = operands;
  const coinIn = coinOf(coinRaw, "goes in");
  const coinOut: "SUI" | "WAL" = coinIn === "SUI" ? "WAL" : "SUI";
  if (options.to !== undefined && coinOf(options.to, "comes out") !== coinOut) {
    throw new NmtsError(`${coinIn} can only be swapped for ${coinOut}.`, { exitCode: 2, nextStep: `Drop --to, or say --to ${coinOut}.` });
  }
  const direction: SwapDirection = coinIn === "SUI" ? "SUI_TO_WAL" : "WAL_TO_SUI";
  if (amountRaw === undefined) {
    throw new NmtsError("Say how much.", { exitCode: 2, nextStep: `\`${BINARY_NAME} wallet swap ${coinIn} <amount|max>\` — "max" swaps everything that can be swapped.` });
  }

  const resolved = await requireAccountCode();
  const address = await walletAddress(resolved.code);
  const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);
  const rails = railsFor(network);
  const reads = await (options.readChain ?? (async (net: Network) => (await import("../wallet-swap-chain.ts")).swapReads(net)))(network);

  // ① The balances — read, and refused as unread rather than treated as zero.
  const purse = await reads.readWallet(address);
  if (!purse.sui.read || !purse.wal.read) {
    const which = [!purse.sui.read ? `SUI: ${purse.sui.why}` : null, !purse.wal.read ? `WAL: ${purse.wal.why}` : null].filter((w) => w !== null);
    throw new NmtsError("A balance could not be read, so this tool cannot tell what can be swapped.", {
      exitCode: 1,
      nextStep: `Nothing was signed. That is not an empty wallet — ${which.join("; ")}.`,
    });
  }
  const sui = purse.sui.baseUnits;
  const wal = purse.wal.baseUnits;

  // ② The numbers — the browser's rules, unchanged. The gas kept back is the cap the person set,
  //    or the same reserve `wallet send` keeps when none was set.
  const gasBudgetMist = options.feeCap === undefined ? undefined : clampGasBudgetMist(parseTokenAmountToBaseUnits(options.feeCap) ?? 0n);
  const keptForGas = gasBudgetMist ?? SUI_GAS_RESERVE_MIST;
  const maxIn = direction === "SUI_TO_WAL" ? maxSwappableSuiMist(sui, keptForGas) : wal;
  const amountInUnits = amountRaw.toLowerCase() === "max" ? maxIn : parseTokenAmountToBaseUnits(amountRaw);
  if (amountInUnits === null || amountInUnits <= 0n) {
    throw new NmtsError("The amount must be a number above zero, with at most nine decimals.", { exitCode: 2 });
  }
  if (amountInUnits > maxIn || (direction === "WAL_TO_SUI" && sui < keptForGas)) {
    throw new NmtsError(
      direction === "WAL_TO_SUI" && sui < keptForGas
        ? "A WAL swap pays its fee in SUI, and the wallet holds less SUI than is kept back for that."
        : "The wallet does not hold that much.",
      {
        exitCode: 4,
        nextStep: `Nothing was signed. The wallet holds ${coinAmount(sui)} SUI and ${coinAmount(wal)} WAL; the most that can go in is ${coinAmount(maxIn)} ${coinIn} (SUI keeps ${coinAmount(keptForGas)} back for the fee).`,
      },
    );
  }
  let slippageBps = SLIPPAGE_BPS_DEFAULT;
  if (options.slippageBps !== undefined) {
    if (!/^\d+$/.test(options.slippageBps.trim())) {
      throw new NmtsError(`--slippage-bps must be a whole number of bps, ${SLIPPAGE_BPS_MIN} to ${SLIPPAGE_BPS_MAX} (1 bps = 0.01%).`, { exitCode: 2 });
    }
    slippageBps = clampSlippageBps(Number(options.slippageBps));
  }

  // ③ The venue and its quote. Testnet has one facility and no choice; mainnet has two and no default.
  let venue: SwapVenue | "exchange";
  let quote: Omit<VenueQuote, "venue">;
  let bluefin: BluefinBinding | undefined;
  let exchange: SwapShape["exchange"];
  if (rails[0] === "exchange") {
    if (options.venue !== undefined) throw new NmtsError(`On testnet the only rail is ${venueName("exchange")}; --venue does not apply.`, { exitCode: 2 });
    if (direction === "WAL_TO_SUI") throw new NmtsError(`${venueName("exchange")} only turns SUI into WAL.`, { exitCode: 2 });
    if (options.slippageBps !== undefined) throw new NmtsError("The testnet facility takes no minimum; --slippage-bps does not apply.", { exitCode: 2 });
    venue = "exchange";
    exchange = await reads.readExchange().catch((error: unknown) => {
      throw new NmtsError("The testnet exchange could not be read, so what it would give is unknown.", { exitCode: 1, nextStep: `Nothing was signed. ${error instanceof Error ? error.message : String(error)}` });
    });
    // The facility's rate is a fraction read off its object; there is no fee to measure and no lot to leave over.
    quote = { outUnits: (amountInUnits * exchange.rateWal) / exchange.rateSui, feeRateBps: null, leftoverInUnits: 0n };
  } else {
    if (options.venue !== undefined && options.venue !== "deepbook" && options.venue !== "bluefin") {
      throw new NmtsError("--venue must be deepbook or bluefin.", { exitCode: 2 });
    }
    const wanted: readonly SwapVenue[] = options.venue === undefined ? ["deepbook", "bluefin"] : [options.venue];
    const answers = await Promise.all(
      wanted.map(async (v): Promise<{ venue: SwapVenue; quote: VenueQuote | null; why: string | null; binding: BluefinBinding | null }> => {
        try {
          const binding = v === "bluefin" ? await reads.resolveBluefin() : null;
          return { venue: v, quote: await reads.quote(v, direction, amountInUnits, binding), why: null, binding };
        } catch (error) {
          return { venue: v, quote: null, why: error instanceof Error ? error.message : String(error), binding: null };
        }
      }),
    );
    if (options.venue === undefined) {
      const lines = answers.map((a) => (a.quote === null ? `${a.venue.padEnd(9)} did not answer — ${a.why}` : quoteLine(a.quote, coinOut, coinIn)));
      if (options.json) {
        say(JSON.stringify({ direction, amountInUnits: amountInUnits.toString(), network, quotes: answers.map((a) => (a.quote === null ? { venue: a.venue, answered: false, why: a.why } : { venue: a.venue, answered: true, outUnits: a.quote.outUnits.toString(), feeRateBps: a.quote.feeRateBps, leftoverInUnits: a.quote.leftoverInUnits.toString() })), signed: false }));
        return 4;
      }
      say(`Quotes for ${coinAmount(amountInUnits)} ${coinIn} → ${coinOut}, read from the ${network} chain just now`);
      for (const line of lines) say(`  ${line}`);
      say(``);
      throw new NmtsError("Neither venue is a default, and this tool recommends neither. Choose one.", {
        exitCode: 4,
        nextStep: `Nothing was signed. Run it again with --venue deepbook or --venue bluefin. Any other exchange may be used instead.`,
      });
    }
    const only = answers[0];
    if (only === undefined || only.quote === null) {
      throw new NmtsError(`${venueName(wanted[0] ?? "deepbook")} did not answer just now.`, { exitCode: 1, nextStep: `Nothing was signed. ${only?.why ?? ""}`.trim() });
    }
    venue = only.venue;
    quote = only.quote;
    bluefin = only.binding ?? undefined;
  }
  if (quote.outUnits <= 0n) {
    throw new NmtsError(`${venueName(venue)} would give nothing for ${coinAmount(amountInUnits)} ${coinIn}: the amount is below one lot, or the book is empty.`, { exitCode: 4, nextStep: "Nothing was signed." });
  }
  const minOutUnits = venue === "exchange" ? 0n : minOutFromQuote(quote.outUnits, slippageBps);
  const shape: SwapShape = { venue, direction, amountInUnits, minOutUnits, gasBudgetMist, bluefin, exchange };

  // ④ The fee of this exact swap. ⑤ The market check, said as unknown when it is.
  const feeMist = await reads.estimateFee(shape, address);
  const prices = await (options.readPrices ?? (async (base: string) => asMarketPrices(await request(base, "/api/prices").catch(() => null))))(server).catch(() => null);
  const market = marketRate(direction, prices?.suiUsd, prices?.walUsd);
  const implied = impliedRate(quote.outUnits, amountInUnits);
  const deviationBps = market !== null && implied !== null ? priceDeviationBps(implied, market) : null;
  const extremes = venue === "exchange" ? [] : swapExtremes({ slippageBps, budgetMist: gasBudgetMist ?? null, estimateMist: feeMist, deviationBps });

  const suiAfter = sui - (direction === "SUI_TO_WAL" ? amountInUnits - quote.leftoverInUnits : -quote.outUnits) - (feeMist ?? 0n);
  const walAfter = wal - (direction === "WAL_TO_SUI" ? amountInUnits - quote.leftoverInUnits : -quote.outUnits);
  const facts = {
    from: address,
    venue,
    direction,
    amountInUnits: amountInUnits.toString(),
    amountIn: coinAmount(amountInUnits),
    coinIn,
    coinOut,
    quotedOutUnits: quote.outUnits.toString(),
    quotedOut: coinAmount(quote.outUnits),
    minOutUnits: minOutUnits.toString(),
    minOut: coinAmount(minOutUnits),
    slippageBps: venue === "exchange" ? null : slippageBps,
    venueFeeBps: quote.feeRateBps,
    leftoverInUnits: quote.leftoverInUnits.toString(),
    feeMist: feeMist === null ? null : feeMist.toString(),
    feeSui: feeMist === null ? null : coinAmount(feeMist),
    feeCapMist: gasBudgetMist === undefined ? null : gasBudgetMist.toString(),
    deviationBps: deviationBps === null ? null : Math.round(deviationBps * 100) / 100,
    extremes,
    network,
    suiAfter: coinAmount(suiAfter < 0n ? 0n : suiAfter),
    walAfter: coinAmount(walAfter < 0n ? 0n : walAfter),
  };

  // ⑥ The review, every time.
  if (!options.json) {
    say(`Swapping ${facts.amountIn} ${coinIn} for ${coinOut} on ${venueName(venue)}`);
    say(`  from      ${address}`);
    say(`  Quoted    ${facts.quotedOut} ${coinOut} — the chain's answer just now, not a promise${quote.leftoverInUnits > 0n ? `; ${coinAmount(quote.leftoverInUnits)} ${coinIn} would come back unused` : ""}`);
    if (venue === "exchange") say(`  Rate      ${exchange?.rateWal} WAL per ${exchange?.rateSui} SUI, read off the facility; it takes no minimum`);
    else say(`  At least  ${facts.minOut} ${coinOut}, or the swap fails on chain — slippage ${slippageBps} bps (${pct(slippageBps)})`);
    say(quote.feeRateBps === null ? `  Venue fee: could not be measured from the quote just now` : `  Venue fee about ${pct(quote.feeRateBps)} of what goes in, measured from the quote`);
    say(feeMist === null ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature` : `  Chain fee about ${facts.feeSui} SUI, measured by a dry run just now — the amount charged is fixed when it executes`);
    if (gasBudgetMist !== undefined) say(`  Fee cap   ${coinAmount(gasBudgetMist)} SUI — only up to this is used; the rest stays`);
    say(deviationBps === null ? `  Market    no reference price could be read just now, so the quote was not compared with the market` : `  Market    ${pct(deviationBps)} from the site's reference price (1 ${coinIn} ≈ ${market?.toFixed(4)} ${coinOut})`);
    say(`  Afterwards, if the chain gives exactly the quote: about ${facts.suiAfter} SUI and ${facts.walAfter} WAL`);
    say(``);
    say(`  NMTS is not a party to this trade and takes nothing from it. Any other exchange may be used instead.`);
    if (extremes.length > 0) {
      say(``);
      say(`  ⛔ Outside the ordinary bands:`);
      for (const e of extremes) say(`     · ${EXTREME_WORDS[e]}`);
    }
  }

  // ⑦ The extremes gate: refused, unless a person said so.
  if (extremes.length > 0 && options.dryRun !== true) {
    if (options.acceptExtremes !== true) {
      if (options.json) {
        say(JSON.stringify({ ...facts, signed: false, refused: "extremes" }));
        return 4;
      }
      throw new NmtsError("Nothing was signed: this swap is outside the ordinary bands.", {
        exitCode: 4,
        nextStep: `Choose again (--slippage-bps 50, a different --fee-cap, the other venue, or later), or — as a person — add --accept-extremes to go on anyway.`,
      });
    }
    const mode = currentMode();
    if (mode === "auto-low" || mode === "auto-high") {
      throw new NmtsError("Going past the extremes gate is a person's act.", { exitCode: 5, nextStep: `Nothing was signed. --accept-extremes is refused in mode auto and with --skip-permissions.` });
    }
  }

  // ⑧ Without --yes, that is the end.
  if (options.dryRun === true || options.yes !== true) {
    if (options.json) {
      say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
      return options.dryRun === true ? 0 : 4;
    }
    say(``);
    if (options.dryRun === true) {
      say(`  Nothing was signed. Run the same command with --yes to swap.`);
      return 0;
    }
    throw new NmtsError("Nothing was signed: swapping needs --yes.", {
      exitCode: 4,
      nextStep: `Read the review above, then run the same command with --yes. The quote will be read again; the chain gives what it gives, never less than the minimum.`,
    });
  }

  // ⑨ The agreement — scope `all`, the amount and the fee held against its ceiling.
  const spend = {
    walFrost: direction === "WAL_TO_SUI" ? amountInUnits : 0n,
    suiMist: (direction === "SUI_TO_WAL" ? amountInUnits : 0n) + (feeMist ?? 0n),
  };
  requireWalletGrant("exchange", spend, new Date(options.now ?? Date.now()));

  // ⑩ The signature.
  const sign = options.sign ?? (await import("../wallet-sign.ts")).signSwap;
  const digest = await sign({ network, code: resolved.code, shape });
  recordWalletSpend(spend);

  if (options.json) {
    say(JSON.stringify({ ...facts, signed: true, digest, explorerUrl: explorerTxUrl(digest, network) }));
    return 0;
  }
  say(``);
  say(`  Swapped. Transaction ${digest}`);
  say(`  ${explorerTxUrl(digest, network)}`);
  say(`  What arrived is what the chain gave — at least the minimum above. \`${BINARY_NAME} wallet\` shows both balances now.`);
  return 0;
}

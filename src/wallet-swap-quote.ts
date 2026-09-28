// A venue's answer, read from the chain: how much comes out now, what stays unused, and the fee the
// quote's own numbers say the venue charges. ⛔ EVERYTHING HERE IS A READ — `devInspect`, no gas,
// no key, no signature, and a zero address as the nominal sender so a quote needs no funded wallet.
//
// ⛔ THE ARITHMETIC IS THE BROWSER'S, copied byte-for-byte (`shared/lib/wallet/swap-rules.ts`); this
//    file only asks the chain and hands the answers to it. DeepBook's fee has no constant: it is
//    MEASURED by quoting the same amount with the fee taken from the input coin and again with the
//    fee paid in DEEP, then comparing output per unit actually spent. Bluefin's quote reports its
//    fee outright (`fee_amount` + `protocol_fee`; both parts count).
//
// ⛔ THREE COINS, SIX DIRECTIONS (SUI, WAL, USDC). Each direction goes through the one pool that holds
//    both coins. On DeepBook, WAL ↔ SUI is also asked THROUGH USDC (WAL_USDC then SUI_USDC in one
//    transaction) and whichever route pays more is the answer — the route travels with the quote, and
//    the swap is built along that same route.
//
// ⛔ A FEE RATE THAT CANNOT BE MEASURED IS NULL, NEVER 0. A quote that cannot be read THROWS — the
//    command says "this venue did not answer", never a number in its place. An output of 0 is an
//    answer, not a failure: the amount is below one lot, or the book is empty.

import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";

import type { walrusClient } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import {
  hopFor,
  PAIR_COINS,
  pickRoute,
  routeHops,
  venueRoutes,
  type SwapHop,
  type SwapPair,
  type SwapRoute,
} from "./shared/lib/wallet/swap-routes.ts";
import {
  combineFeeBps,
  deepbookRowFrom,
  directionCoins,
  feeRateBpsOf,
  measureDeepbookFeeBps,
  type SwapCoin,
  type SwapDirection,
  type SwapVenue,
} from "./shared/lib/wallet/swap-rules.ts";
import {
  BLUEFIN_MAX_SQRT_PRICE,
  BLUEFIN_MIN_SQRT_PRICE,
  DEEPBOOK_PACKAGE_IDS,
  DEEPBOOK_SUI_USDC_POOLS,
  DEEPBOOK_WAL_SUI_POOLS,
  DEEPBOOK_WAL_USDC_POOLS,
  USDC_COIN_TYPES,
} from "./shared/lib/wallet/venue-ids.ts";
import { SUI_COIN_TYPE, walCoinType } from "./wallet.ts";

/** The zero address: a quote is a read, and a read needs no wallet. */
export const QUOTE_SENDER = `0x${"0".repeat(64)}`;

/** One venue's answer, now. Every field was read from the chain this moment; none is a constant. */
export interface VenueQuote {
  venue: SwapVenue;
  /** What comes out AFTER the venue's fee, in the output coin's base units. */
  outUnits: bigint;
  /** The fee this quote carries, in bps (two decimals). Null = could not be measured, not 0. */
  feeRateBps: number | null;
  /** Input that would come back unused (DeepBook rounds to its lot size). */
  leftoverInUnits: bigint;
  /** The route this answer came from — the swap is built along exactly this route. */
  route: SwapRoute;
  /** USDC the second pool of a through-USDC route would hand back unused. 0n on a direct route. */
  leftoverMidUnits: bigint;
}

/** The pools a venue has on a network, per pair. Null = none there, and nothing is guessed. */
export type VenuePools = Readonly<Record<SwapPair, string | null>>;

/** The three exact coin types of a network. ⛔ A coin is matched by this whole type, never a symbol. */
export function swapCoinTypes(network: Network): Readonly<Record<SwapCoin, string>> {
  return { SUI: SUI_COIN_TYPE, WAL: walCoinType(network), USDC: USDC_COIN_TYPES[network] };
}

/** DeepBook's order books on a network. */
export function deepbookPools(network: Network): VenuePools {
  return {
    WAL_SUI: DEEPBOOK_WAL_SUI_POOLS[network],
    SUI_USDC: DEEPBOOK_SUI_USDC_POOLS[network],
    WAL_USDC: DEEPBOOK_WAL_USDC_POOLS[network],
  };
}

/** The pool's two coin types, in pool order (first coin = DeepBook base = Bluefin coin_a). */
export function pairTypes(network: Network, pair: SwapPair): [string, string] {
  const types = swapCoinTypes(network);
  const [first, second] = PAIR_COINS[pair];
  return [types[first], types[second]];
}

/** A pool's id, or a throw when this tool knows none on that network. */
export function poolIdOf(pools: VenuePools, pair: SwapPair, venue: SwapVenue): string {
  const id = pools[pair];
  if (id === null) throw new Error(`this tool knows no ${venue} ${pair} pool on this network`);
  return id;
}

/** The routes a venue can build for a direction with the pools it has. */
export function routesWithPools(venue: SwapVenue, direction: SwapDirection, pools: VenuePools): SwapRoute[] {
  return venueRoutes(venue, direction).filter((route) => {
    const hops = routeHops(direction, route);
    return hops !== null && hops.every((hop) => pools[hop.pair] !== null);
  });
}

type Client = ReturnType<typeof walrusClient>;
type ReturnValue = [number[], string];

function readU64(value: ReturnValue): bigint {
  return BigInt(bcs.U64.parse(Uint8Array.from(value[0])));
}

/**
 * The FRONT of Bluefin's `SwapResult`, in the order its `pool.move` declares them. BCS reads from
 * the front, so the fields behind these need not be known. The first three are checked against the
 * question asked; if they do not echo it, the rest cannot be trusted either.
 */
const BluefinSwapResultPrefix = bcs.struct("BluefinSwapResultPrefix", {
  a2b: bcs.bool(),
  by_amount_in: bcs.bool(),
  amount_specified: bcs.u64(),
  amount_specified_remaining: bcs.u64(),
  amount_calculated: bcs.u64(),
  fee_growth_global: bcs.u128(),
  fee_amount: bcs.u64(),
  protocol_fee: bcs.u64(),
});

async function quoteBluefin(
  client: Client,
  network: Network,
  direction: SwapDirection,
  amountInUnits: bigint,
  binding: { packageId: string; pools: VenuePools },
): Promise<VenueQuote> {
  const { in: from, out: to } = directionCoins(direction);
  const hop = hopFor(from, to);
  const a2b = hop.sellsFirst;
  const tx = new Transaction();
  tx.moveCall({
    target: `${binding.packageId}::pool::calculate_swap_results`,
    typeArguments: pairTypes(network, hop.pair),
    arguments: [
      tx.object(poolIdOf(binding.pools, hop.pair, "bluefin")),
      tx.pure.bool(a2b),
      tx.pure.bool(true),
      tx.pure.u64(amountInUnits),
      tx.pure.u128(a2b ? BLUEFIN_MIN_SQRT_PRICE : BLUEFIN_MAX_SQRT_PRICE),
    ],
  });
  const res = await client.devInspectTransactionBlock({ sender: QUOTE_SENDER, transactionBlock: tx });
  if (res.error) throw new Error(`the Bluefin quote was refused on chain: ${res.error}`);
  const returned = res.results?.[0]?.returnValues;
  const first = returned?.[0];
  if (first === undefined) throw new Error("the Bluefin quote came back with no value");
  const result = BluefinSwapResultPrefix.parse(Uint8Array.from(first[0]));
  if (result.a2b !== a2b || result.by_amount_in !== true || BigInt(result.amount_specified) !== amountInUnits) {
    throw new Error("the Bluefin quote did not echo the question it was asked");
  }
  return {
    venue: "bluefin",
    outUnits: BigInt(result.amount_calculated),
    feeRateBps: feeRateBpsOf(BigInt(result.fee_amount) + BigInt(result.protocol_fee), amountInUnits),
    leftoverInUnits: BigInt(result.amount_specified_remaining),
    route: "direct",
    leftoverMidUnits: 0n,
  };
}

/** One DeepBook pool's answer: what comes out, what is left over, and the fee measured on that pool. */
async function quoteDeepbookHop(
  client: Client,
  network: Network,
  hop: SwapHop,
  amountInUnits: bigint,
): Promise<{ outUnits: bigint; leftoverInUnits: bigint; feeRateBps: number | null }> {
  const pkg = DEEPBOOK_PACKAGE_IDS[network];
  const pool = poolIdOf(deepbookPools(network), hop.pair, "deepbook");
  const types = pairTypes(network, hop.pair);
  const inputFeeFn = hop.sellsFirst ? "get_quote_quantity_out_input_fee" : "get_base_quantity_out_input_fee";
  const deepModeArgs: readonly [bigint, bigint] = hop.sellsFirst ? [amountInUnits, 0n] : [0n, amountInUnits];
  const build = (withDeepMode: boolean): Transaction => {
    const tx = new Transaction();
    tx.moveCall({
      target: `${pkg}::pool::${inputFeeFn}`,
      typeArguments: types,
      arguments: [tx.object(pool), tx.pure.u64(amountInUnits), tx.object.clock()],
    });
    if (withDeepMode) {
      tx.moveCall({
        target: `${pkg}::pool::get_quantity_out`,
        typeArguments: types,
        arguments: [tx.object(pool), tx.pure.u64(deepModeArgs[0]), tx.pure.u64(deepModeArgs[1]), tx.object.clock()],
      });
    }
    return tx;
  };
  // Both modes in ONE inspection so they see the same book. If the DEEP-mode call is refused, the
  // quote is asked again alone: what comes out matters more than what the fee was.
  let res = await client.devInspectTransactionBlock({ sender: QUOTE_SENDER, transactionBlock: build(true) });
  let deepModeAnswered = true;
  if (res.error) {
    deepModeAnswered = false;
    res = await client.devInspectTransactionBlock({ sender: QUOTE_SENDER, transactionBlock: build(false) });
  }
  if (res.error) throw new Error(`the DeepBook quote was refused on chain: ${res.error}`);
  const rowOf = (values: readonly ReturnValue[] | undefined) =>
    values !== undefined && values.length >= 3 && values[0] !== undefined && values[1] !== undefined
      ? deepbookRowFrom(hop.sellsFirst, readU64(values[0]), readU64(values[1]))
      : null;
  const inputMode = rowOf(res.results?.[0]?.returnValues);
  if (inputMode === null) throw new Error("the DeepBook quote came back in a shape this tool does not read");
  const deepMode = deepModeAnswered ? rowOf(res.results?.[1]?.returnValues) : null;
  return {
    outUnits: inputMode.outUnits,
    leftoverInUnits: inputMode.leftoverInUnits,
    feeRateBps: measureDeepbookFeeBps(amountInUnits, inputMode, deepMode),
  };
}

/**
 * One DeepBook route. Through USDC, the USDC the first pool gives is asked of the second; when the
 * first gives nothing (below that book's one-coin minimum), the route answers 0 without asking —
 * DeepBook refuses a question about 0.
 */
async function quoteDeepbookRoute(
  client: Client,
  network: Network,
  direction: SwapDirection,
  route: SwapRoute,
  amountInUnits: bigint,
): Promise<VenueQuote> {
  const hops = routeHops(direction, route);
  const firstHop = hops?.[0];
  if (hops === null || firstHop === undefined) throw new Error(`DeepBook has no ${route} route for ${direction}`);
  const first = await quoteDeepbookHop(client, network, firstHop, amountInUnits);
  const secondHop = hops[1];
  if (secondHop === undefined) {
    return { venue: "deepbook", ...first, route, leftoverMidUnits: 0n };
  }
  if (first.outUnits <= 0n) {
    return { venue: "deepbook", outUnits: 0n, feeRateBps: null, leftoverInUnits: first.leftoverInUnits, route, leftoverMidUnits: 0n };
  }
  const second = await quoteDeepbookHop(client, network, secondHop, first.outUnits);
  return {
    venue: "deepbook",
    outUnits: second.outUnits,
    feeRateBps: combineFeeBps(first.feeRateBps, second.feeRateBps),
    leftoverInUnits: first.leftoverInUnits,
    route,
    leftoverMidUnits: second.leftoverInUnits,
  };
}

async function quoteDeepbook(
  client: Client,
  network: Network,
  direction: SwapDirection,
  amountInUnits: bigint,
): Promise<VenueQuote> {
  const routes = routesWithPools("deepbook", direction, deepbookPools(network));
  if (routes.length === 0) throw new Error(`this tool knows no DeepBook pool for ${direction} on ${network}`);
  const settled = await Promise.allSettled(
    routes.map((route) => quoteDeepbookRoute(client, network, direction, route, amountInUnits)),
  );
  const answered: VenueQuote[] = [];
  let reason: unknown = null;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") answered.push(outcome.value);
    else reason = outcome.reason;
  }
  const best = pickRoute(answered);
  if (best === null) throw reason instanceof Error ? reason : new Error(String(reason));
  return best;
}

/** One venue's answer now. Bluefin needs its resolved binding; DeepBook needs nothing resolved. */
export async function quoteVenue(
  client: Client,
  network: Network,
  venue: SwapVenue,
  direction: SwapDirection,
  amountInUnits: bigint,
  bluefin: { packageId: string; pools: VenuePools } | null,
): Promise<VenueQuote> {
  if (amountInUnits <= 0n) throw new Error("a swap quote needs an amount above zero");
  if (venue === "deepbook") return quoteDeepbook(client, network, direction, amountInUnits);
  if (bluefin === null) throw new Error("Bluefin's package was not resolved");
  return quoteBluefin(client, network, direction, amountInUnits, bluefin);
}

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
// ⛔ A FEE RATE THAT CANNOT BE MEASURED IS NULL, NEVER 0. A quote that cannot be read THROWS — the
//    command says "this venue did not answer", never a number in its place. An output of 0 is an
//    answer, not a failure: the amount is below one lot, or the book is empty.

import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";

import type { walrusClient } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import {
  deepbookRowFrom,
  feeRateBpsOf,
  measureDeepbookFeeBps,
  type SwapDirection,
  type SwapVenue,
} from "./shared/lib/wallet/swap-rules.ts";
import {
  BLUEFIN_MAX_SQRT_PRICE,
  BLUEFIN_MIN_SQRT_PRICE,
  DEEPBOOK_PACKAGE_IDS,
  DEEPBOOK_WAL_SUI_POOLS,
} from "./shared/lib/wallet/venue-ids.ts";
import { SUI_COIN_TYPE, walCoinType } from "./wallet.ts";

/** The zero address: a quote is a read, and a read needs no wallet. */
export const QUOTE_SENDER = `0x${"0".repeat(64)}`;

/** One venue's answer, now. Every field was read from the chain this moment; none is a constant. */
export interface VenueQuote {
  venue: SwapVenue;
  /** What comes out AFTER the venue's fee, in base units. */
  outUnits: bigint;
  /** The fee this quote carries, in bps (two decimals). Null = could not be measured, not 0. */
  feeRateBps: number | null;
  /** Input that would come back unused (DeepBook rounds to its lot size). */
  leftoverInUnits: bigint;
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
  binding: { packageId: string; poolId: string },
): Promise<VenueQuote> {
  const a2b = direction === "WAL_TO_SUI";
  const tx = new Transaction();
  tx.moveCall({
    target: `${binding.packageId}::pool::calculate_swap_results`,
    typeArguments: [walCoinType(network), SUI_COIN_TYPE],
    arguments: [
      tx.object(binding.poolId),
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
  };
}

async function quoteDeepbook(
  client: Client,
  network: Network,
  direction: SwapDirection,
  amountInUnits: bigint,
): Promise<VenueQuote> {
  const pkg = DEEPBOOK_PACKAGE_IDS[network];
  const pool = DEEPBOOK_WAL_SUI_POOLS[network];
  const types = [walCoinType(network), SUI_COIN_TYPE];
  const inputFeeFn = direction === "SUI_TO_WAL" ? "get_base_quantity_out_input_fee" : "get_quote_quantity_out_input_fee";
  const deepModeArgs: readonly [bigint, bigint] = direction === "SUI_TO_WAL" ? [0n, amountInUnits] : [amountInUnits, 0n];
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
      ? deepbookRowFrom(direction, readU64(values[0]), readU64(values[1]))
      : null;
  const inputMode = rowOf(res.results?.[0]?.returnValues);
  if (inputMode === null) throw new Error("the DeepBook quote came back in a shape this tool does not read");
  const deepMode = deepModeAnswered ? rowOf(res.results?.[1]?.returnValues) : null;
  return {
    venue: "deepbook",
    outUnits: inputMode.outUnits,
    feeRateBps: measureDeepbookFeeBps(amountInUnits, inputMode, deepMode),
    leftoverInUnits: inputMode.leftoverInUnits,
  };
}

/** One venue's answer now. Bluefin needs its resolved binding; DeepBook needs nothing resolved. */
export async function quoteVenue(
  client: Client,
  network: Network,
  venue: SwapVenue,
  direction: SwapDirection,
  amountInUnits: bigint,
  bluefin: { packageId: string; poolId: string } | null,
): Promise<VenueQuote> {
  if (amountInUnits <= 0n) throw new Error("a swap quote needs an amount above zero");
  if (venue === "deepbook") return quoteDeepbook(client, network, direction, amountInUnits);
  if (bluefin === null) throw new Error("Bluefin's package was not resolved");
  return quoteBluefin(client, network, direction, amountInUnits, bluefin);
}

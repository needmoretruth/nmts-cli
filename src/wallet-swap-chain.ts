// The swap transaction and its live reads: the wallet's balances, Bluefin's current package, the
// testnet facility's rate, and the fee a dry run measures. The quotes live next door in
// `wallet-swap-quote.ts`; both files read, and only `wallet-sign.ts` signs.
//
// ⛔ ONE BUILDER FOR THE FEE AND THE SIGNATURE. `estimateFee` and `wallet-sign.ts` both call
//    `swapTransaction`, so the fee printed is the fee of the transaction that is then signed.
//
// ⛔ THE SHAPES ARE THE BROWSER'S, CALL FOR CALL. DeepBook: `pool::swap_exact_quote_for_base` (SUI→WAL)
//    or `swap_exact_base_for_quote` (WAL→SUI) with an EMPTY DEEP coin so the fee comes off the input
//    coin, and all THREE outputs (base, quote, DEEP) sent back to the signer — Move cannot drop a
//    coin, so a forgotten one aborts the whole transaction. Bluefin: `gateway::swap_assets`, which
//    sends its outputs to the sender itself; type arguments always in pool order [WAL, SUI], the
//    direction carried by the `a2b` flag, and a sqrt-price limit one step inside the tick range
//    (the exact end aborts). Testnet: the official Walrus facility `wal_exchange::exchange_all_for_wal`,
//    SUI→WAL only, whose package is read off the Exchange object's own type. The ids come from
//    `shared/lib/wallet/venue-ids.ts`, copied byte-for-byte from the browser.
//
// ⛔ OUR SHARE IS ZERO. No NMTS address, no fee argument, no output of ours in any of the three.

import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { TESTNET_WALRUS_PACKAGE_CONFIG } from "@mysten/walrus";

import { walrusClient, netGasFee } from "./extend-chain.ts";
import { isRecord } from "./guards.ts";
import type { Network } from "./network.ts";
import type { SwapDirection, SwapVenue } from "./shared/lib/wallet/swap-rules.ts";
import {
  BLUEFIN_GLOBAL_CONFIG_IDS,
  BLUEFIN_MAX_SQRT_PRICE,
  BLUEFIN_MIN_SQRT_PRICE,
  BLUEFIN_PACKAGE_IDS,
  BLUEFIN_UPGRADE_CAP_IDS,
  BLUEFIN_WAL_SUI_POOLS,
  DEEP_COIN_TYPES,
  DEEPBOOK_PACKAGE_IDS,
  DEEPBOOK_WAL_SUI_POOLS,
} from "./shared/lib/wallet/venue-ids.ts";
import { readBalances, SUI_COIN_TYPE, walCoinType, type WalletBalances } from "./wallet.ts";
import { chainReader } from "./wallet-chain.ts";
import { quoteVenue, QUOTE_SENDER, type VenueQuote } from "./wallet-swap-quote.ts";

/** Where a swap runs: one of the two mainnet venues, or the official testnet facility. */
export type SwapRail = SwapVenue | "exchange";

/** Bluefin's addresses, with the package RESOLVED and version-checked on chain, never assumed. */
export interface BluefinBinding {
  packageId: string;
  globalConfigId: string;
  poolId: string;
}

/** The testnet facility: its object, the package its type names, and its rate (WAL per SUI, as a fraction). */
export interface ExchangeFacility {
  objectId: string;
  packageId: string;
  rateWal: bigint;
  rateSui: bigint;
}

export interface SwapShape {
  venue: SwapRail;
  direction: SwapDirection;
  amountInUnits: bigint;
  /** The least to accept, or the chain refuses the swap. The facility has no such argument: 0n. */
  minOutUnits: bigint;
  /** A gas ceiling, or undefined to let the SDK set one from its own dry run. */
  gasBudgetMist?: bigint | undefined;
  /** Present exactly when `venue` is bluefin: the signature uses the package the quote used. */
  bluefin?: BluefinBinding | undefined;
  /** Present exactly when `venue` is exchange. */
  exchange?: ExchangeFacility | undefined;
}

/** The rails a network has. Testnet's DeepBook book trades a different WAL, and Bluefin has none. */
export function railsFor(network: Network): readonly SwapRail[] {
  return network === "mainnet" ? ["deepbook", "bluefin"] : ["exchange"];
}

export function swapTransaction(input: SwapShape & { network: Network; sender: string }): Transaction {
  const tx = new Transaction();
  tx.setSender(input.sender);
  const walType = walCoinType(input.network);
  const a2b = input.direction === "WAL_TO_SUI";
  const coinIn = a2b
    ? tx.add(coinWithBalance({ balance: input.amountInUnits, type: walType }))
    : tx.splitCoins(tx.gas, [input.amountInUnits])[0];

  if (input.venue === "deepbook") {
    const deepIn = tx.moveCall({ target: "0x2::coin::zero", typeArguments: [DEEP_COIN_TYPES[input.network]] });
    const swapped = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_IDS[input.network]}::pool::${a2b ? "swap_exact_base_for_quote" : "swap_exact_quote_for_base"}`,
      typeArguments: [walType, SUI_COIN_TYPE],
      arguments: [tx.object(DEEPBOOK_WAL_SUI_POOLS[input.network]), coinIn, deepIn, tx.pure.u64(input.minOutUnits), tx.object.clock()],
    });
    // All three outputs — base, quote, DEEP — go back to the signer. The result is indexed, and an
    // index is typed as possibly absent; nothing below can build a transfer of fewer than three.
    const outputs = [swapped[0], swapped[1], swapped[2]].filter((coin) => coin !== undefined);
    if (outputs.length !== 3) throw new Error("DeepBook's swap did not yield its three outputs.");
    tx.transferObjects(outputs, input.sender);
  } else if (input.venue === "bluefin") {
    if (input.bluefin === undefined) throw new Error("A Bluefin swap needs its resolved package first.");
    const coinZero = tx.moveCall({ target: "0x2::coin::zero", typeArguments: [a2b ? SUI_COIN_TYPE : walType] });
    tx.moveCall({
      target: `${input.bluefin.packageId}::gateway::swap_assets`,
      typeArguments: [walType, SUI_COIN_TYPE],
      arguments: [
        tx.object.clock(),
        tx.object(input.bluefin.globalConfigId),
        tx.object(input.bluefin.poolId),
        a2b ? coinIn : coinZero,
        a2b ? coinZero : coinIn,
        tx.pure.bool(a2b),
        tx.pure.bool(true),
        tx.pure.u64(input.amountInUnits),
        tx.pure.u64(input.minOutUnits),
        tx.pure.u128(a2b ? BLUEFIN_MIN_SQRT_PRICE : BLUEFIN_MAX_SQRT_PRICE),
      ],
    });
  } else {
    if (input.exchange === undefined) throw new Error("The testnet exchange needs its object first.");
    if (a2b) throw new Error("The testnet facility only turns SUI into WAL.");
    const walOut = tx.moveCall({
      target: `${input.exchange.packageId}::wal_exchange::exchange_all_for_wal`,
      arguments: [tx.object(input.exchange.objectId), coinIn],
    });
    tx.transferObjects([walOut], input.sender);
  }
  if (input.gasBudgetMist !== undefined) tx.setGasBudget(input.gasBudgetMist);
  return tx;
}

/** What `commands/wallet-swap.ts` reads before it prints a review. */
export interface SwapReads {
  readWallet(address: string): Promise<WalletBalances>;
  /** Bluefin's current package, version-checked. Throws when no known package passes. */
  resolveBluefin(): Promise<BluefinBinding>;
  /** The testnet facility and its rate. Throws off testnet, or when the object cannot be read. */
  readExchange(): Promise<ExchangeFacility>;
  /** One venue's answer now. Throws when it does not answer — never a number in its place. */
  quote(venue: SwapVenue, direction: SwapDirection, amountInUnits: bigint, bluefin: BluefinBinding | null): Promise<VenueQuote>;
  /** The fee in MIST measured by dry-running this exact swap, or null when it could not be. */
  estimateFee(shape: SwapShape, sender: string): Promise<bigint | null>;
}

const FULL_ADDRESS = /^0x[0-9a-f]{64}$/;

/** `fields.<name>` of a Move object's content, as a string, or null when the shape differs. */
function fieldOf(content: unknown, name: string): unknown {
  const fields: unknown = isRecord(content) ? content["fields"] : undefined;
  return isRecord(fields) ? fields[name] : undefined;
}

export function swapReads(network: Network): SwapReads {
  const client = walrusClient(network);
  let bluefin: Promise<BluefinBinding> | null = null;

  async function livePackage(upgradeCapId: string): Promise<string | null> {
    try {
      const obj = await client.getObject({ id: upgradeCapId, options: { showContent: true, showType: true } });
      if (obj.data?.type !== "0x2::package::UpgradeCap") return null;
      const pkg = fieldOf(obj.data.content, "package");
      return typeof pkg === "string" && FULL_ADDRESS.test(pkg) ? pkg : null;
    } catch {
      return null;
    }
  }
  async function versionPasses(packageId: string, globalConfigId: string): Promise<boolean> {
    try {
      const tx = new Transaction();
      tx.moveCall({ target: `${packageId}::config::verify_version`, arguments: [tx.object(globalConfigId)] });
      const res = await client.devInspectTransactionBlock({ sender: QUOTE_SENDER, transactionBlock: tx });
      return !res.error;
    } catch {
      return false;
    }
  }

  return {
    async readWallet(address) {
      return readBalances(chainReader(network, address), walCoinType(network));
    },
    async resolveBluefin() {
      // Memoised for the run, and a failure is not memoised: one refusal must not become "no Bluefin".
      if (bluefin !== null) return bluefin;
      const pending = (async (): Promise<BluefinBinding> => {
        const pinned = BLUEFIN_PACKAGE_IDS[network];
        const capId = BLUEFIN_UPGRADE_CAP_IDS[network];
        const globalConfigId = BLUEFIN_GLOBAL_CONFIG_IDS[network];
        const poolId = BLUEFIN_WAL_SUI_POOLS[network];
        if (pinned === null || capId === null || globalConfigId === null || poolId === null) {
          throw new Error(`This tool knows no Bluefin WAL/SUI pool on ${network}.`);
        }
        const live = await livePackage(capId);
        for (const packageId of live === null ? [pinned] : [live, pinned]) {
          if (await versionPasses(packageId, globalConfigId)) return { packageId, globalConfigId, poolId };
        }
        throw new Error("Bluefin's on-chain version check refused every package address this tool knows.");
      })();
      bluefin = pending;
      pending.catch(() => {
        if (bluefin === pending) bluefin = null;
      });
      return pending;
    },
    async readExchange() {
      if (network !== "testnet") throw new Error("The built-in SUI→WAL exchange is a testnet-only facility.");
      const objectId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0];
      if (objectId === undefined) throw new Error("This build names no testnet exchange object.");
      const obj = await client.getObject({ id: objectId, options: { showContent: true, showType: true } });
      const type = obj.data?.type;
      if (typeof type !== "string" || !type.includes("::wal_exchange::Exchange")) {
        throw new Error(`Object ${objectId} is not a wal_exchange Exchange (type ${type ?? "unknown"}).`);
      }
      const rate = fieldOf(obj.data?.content, "rate");
      const wal = fieldOf(rate, "wal");
      const sui = fieldOf(rate, "sui");
      if (typeof wal !== "string" || typeof sui !== "string" || !/^\d+$/.test(wal) || !/^\d+$/.test(sui) || BigInt(sui) === 0n) {
        throw new Error("The exchange's rate could not be read off its object, so what it would give is unknown.");
      }
      return { objectId, packageId: type.split("::")[0] ?? "", rateWal: BigInt(wal), rateSui: BigInt(sui) };
    },
    async quote(venue, direction, amountInUnits, binding) {
      return quoteVenue(client, network, venue, direction, amountInUnits, binding);
    },
    async estimateFee(shape, sender) {
      try {
        const bytes = await swapTransaction({ ...shape, network, sender }).build({ client });
        const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
        if (effects.status.status !== "success") return null;
        return netGasFee(effects.gasUsed);
      } catch {
        return null;
      }
    },
  };
}

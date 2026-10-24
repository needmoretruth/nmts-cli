// The real chain reads behind `nmts wallet` — the only file in this command that loads the Sui SDK.
//
// ⛔ SPLIT OUT SO THE COMMAND CAN BE TESTED. `wallet.ts` decides what a balance means and what is
//    said when there is none; this only knows how to ask. Keeping the SDK out of the deciding half
//    is what lets `node --test` drive every branch — including the ones a live chain would only
//    produce by being broken.
//
// ⛔ IT READS AND CANNOT DO ANYTHING ELSE. No signer is built here, no transaction is assembled,
//    and the two calls below are the whole of this file's contact with the network: what one
//    address holds, and whether a coin type exists. A balance is public data — anybody can ask the
//    same question about the same address — so nothing about this run leaves that was not already
//    published by the chain itself.

import { RpcError } from "@mysten/sui/grpc";

import type { Network } from "./network.ts";
import { suiClient } from "./sui-rpc.ts";
import type { ChainReader } from "./wallet.ts";

/**
 * How long one balance question gets.
 *
 * A read that stalls is a read that failed, and the caller has something honest to print either
 * way. Long enough for a slow public node, short enough that an agent waiting on this does not
 * conclude the tool has hung.
 */
export const BALANCE_TIMEOUT_MS = 20_000;

/**
 * Read balances for one address on one network.
 *
 * ⚠ THE NODE IS NOT TRUSTED WITH ANYTHING, and it does not have to be: what it answers is printed
 *   as a number and nothing is decided on it. A node that lies about a balance produces a wrong
 *   number on a screen — where its owner will see it disagree with every other wallet they own —
 *   and it cannot produce a wrong address, because the address never came from it.
 */
export function chainReader(network: Network, address: string): ChainReader {
  // The network name reaches the SDK as well as the URL, which is what keeps a mirror pointed at
  // the wrong chain from being discovered later, as an answer that quietly made no sense.
  const client = suiClient(network);
  return {
    async totalOf(coinType: string): Promise<bigint> {
      const { balance } = await client.core.getBalance({
        owner: address,
        coinType,
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      });
      return baseUnitsOf(balance.balance);
    },
    async knowsCoinType(coinType: string): Promise<boolean> {
      // ⛔ ASKED RAW, NOT THROUGH `client.core.getCoinMetadata`: that helper answers `null` for ANY
      //    failure, a timeout included, and then "the node did not answer" would print as "this
      //    chain does not know the coin". The node's own answer for a type that does not exist is the
      //    status NOT_FOUND (measured on both networks' four hosts, 2026-10-21); every other failure
      //    is thrown, which the caller reports as "could not be confirmed".
      try {
        const { response } = await client.stateService.getCoinInfo(
          { coinType },
          { abort: AbortSignal.timeout(BALANCE_TIMEOUT_MS) },
        );
        return response.metadata !== undefined;
      } catch (error) {
        if (error instanceof RpcError && error.code === "NOT_FOUND") return false;
        throw error;
      }
    },
  };
}

/**
 * A total off the wire, as base units.
 *
 * ⛔ A STRING, AND IT STAYS EXACT. Balances run past what a JavaScript number holds without losing
 *    digits, so the value is never converted through one. Anything that is not a whole,
 *    non-negative count of base units is refused rather than rounded into something printable:
 *    this tool would rather say it could not read the balance than print a number the chain did
 *    not say.
 */
function baseUnitsOf(total: string): bigint {
  let units: bigint;
  try {
    units = BigInt(total);
  } catch {
    throw new Error("the chain answered with a balance this tool cannot read as a number");
  }
  if (units < 0n) throw new Error("the chain answered with a negative balance, which is not a balance");
  return units;
}

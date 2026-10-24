// The live read behind `nmts wallet activity`: the chain's list for one address.
//
// ⛔ READ ONLY. The same gRPC client `wallet-chain.ts` reads balances with, and the browser's own
//    question (`shared/lib/wallet/address-history.ts`); nothing here builds or signs a transaction.
//    Imported lazily, only when no seam was supplied.

import { FETCH, type ActivityFetch } from "./commands/wallet-activity.ts";
import type { Network } from "./network.ts";
import { addressTransactions } from "./shared/lib/wallet/address-history.ts";
import { deeperHistory, suiClient } from "./sui-rpc.ts";

/** How long the question gets. A read that stalls is a read that failed. */
export const ACTIVITY_TIMEOUT_MS = 20_000;

export async function queryActivity(network: Network, address: string): Promise<ActivityFetch> {
  const { transactions, complete } = await addressTransactions(
    suiClient(network),
    address,
    FETCH,
    AbortSignal.timeout(ACTIVITY_TIMEOUT_MS),
    // Past the node's few-week window, the older rows come from Sui's GraphQL service.
    deeperHistory(network),
  );
  return { transactions, complete };
}

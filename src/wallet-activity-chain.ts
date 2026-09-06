// The live read behind `nmts wallet activity`: the chain's two lists for one address.
//
// ⛔ READ ONLY. The same JSON-RPC client `wallet-chain.ts` reads balances with; nothing here builds
//    or signs a transaction. Imported lazily, only when no seam was supplied.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

import type { ActivityFetch } from "./commands/wallet-activity.ts";
import { FETCH_PER_DIRECTION } from "./commands/wallet-activity.ts";
import type { Network } from "./network.ts";
import { suiRpcTransport } from "./sui-rpc.ts";

/** How long the two questions get together. A read that stalls is a read that failed. */
export const ACTIVITY_TIMEOUT_MS = 20_000;

export async function queryActivity(network: Network, address: string): Promise<ActivityFetch> {
  const client = new SuiJsonRpcClient({ network, transport: suiRpcTransport(network) });
  const options = { showBalanceChanges: true, showInput: true, showEffects: true };
  const signal = AbortSignal.timeout(ACTIVITY_TIMEOUT_MS);
  const [sent, received] = await Promise.all([
    client.queryTransactionBlocks({
      filter: { FromAddress: address },
      options,
      limit: FETCH_PER_DIRECTION,
      order: "descending",
      signal,
    }),
    client.queryTransactionBlocks({
      filter: { ToAddress: address },
      options,
      limit: FETCH_PER_DIRECTION,
      order: "descending",
      signal,
    }),
  ]);
  return { sent: sent.data, received: received.data };
}

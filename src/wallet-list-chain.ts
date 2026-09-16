// The live read behind `nmts wallet list`'s walk: has this address ever been in a transaction?
//
// ⛔ READ ONLY, and one question in each direction. The RPC filter has no OR, so "from" and "to"
//    are asked separately — a wallet that only ever RECEIVED is in use too, and a walk that asked
//    about balances alone would report a wallet somebody emptied as one that does not exist.
//
// ⚠ ONE transaction is enough to answer, so one is what is asked for. This runs once per wallet
//   the walk looks at, which is why it asks for as little as the chain will sell.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

import type { Network } from "./network.ts";
import { suiRpcTransport } from "./sui-rpc.ts";

/** How long the two questions get together. A read that stalls is a read that failed. */
export const HISTORY_TIMEOUT_MS = 20_000;

export async function hasHistory(network: Network, address: string): Promise<boolean> {
  const client = new SuiJsonRpcClient({ network, transport: suiRpcTransport(network) });
  const signal = AbortSignal.timeout(HISTORY_TIMEOUT_MS);
  const sent = await client.queryTransactionBlocks({ filter: { FromAddress: address }, limit: 1, signal });
  if (sent.data.length > 0) return true;
  const received = await client.queryTransactionBlocks({ filter: { ToAddress: address }, limit: 1, signal });
  return received.data.length > 0;
}

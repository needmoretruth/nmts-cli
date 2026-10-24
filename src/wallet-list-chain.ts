// The live read behind `nmts wallet list`'s walk: has this address ever been in a transaction?
//
// ⛔ READ ONLY, and ONE question since 2026-10-21. The retired JSON-RPC filter had no OR, so "from"
//    and "to" were asked separately; the gRPC ledger index answers "every transaction that moved this
//    address" in one (`shared/lib/wallet/address-history.ts`, the browser's copy). A wallet that only
//    ever RECEIVED is in use too, and a walk that asked about balances alone would report a wallet
//    somebody emptied as one that does not exist.
//
// ⚠ ONE transaction is enough to answer, so one is what is asked for. This runs once per wallet
//   the walk looks at, which is why it asks for as little as the chain will sell. A scan the node
//   stopped short of the end throws instead of answering "no" — the walk then says it could not read.
// ⛔ A node keeps only weeks of history, so "nothing lately" is followed by one question to Sui's
//   GraphQL service before it may become "never used" (`deeperHistory`).

import type { Network } from "./network.ts";
import { hasAddressHistory } from "./shared/lib/wallet/address-history.ts";
import { deeperHistory, suiClient } from "./sui-rpc.ts";

/** How long the question gets. A read that stalls is a read that failed. */
export const HISTORY_TIMEOUT_MS = 20_000;

export async function hasHistory(network: Network, address: string): Promise<boolean> {
  return hasAddressHistory(
    suiClient(network),
    address,
    AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    deeperHistory(network),
  );
}

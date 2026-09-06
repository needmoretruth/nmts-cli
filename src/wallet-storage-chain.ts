// The live read behind `nmts wallet storage`: the resources one address holds, and the epoch.
//
// ⛔ READ ONLY, and the reader is the browser's (`shared/lib/storage-control/chain.ts`). The epoch
//    comes from the same window read `nmts extend` prices with; when that read fails the list is
//    still printed, without the "usable now" judgement, rather than not at all.

import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { MAINNET_WALRUS_PACKAGE_CONFIG, TESTNET_WALRUS_PACKAGE_CONFIG } from "@mysten/walrus";

import type { StorageRead } from "./commands/wallet-storage.ts";
import { extendReads } from "./extend-chain.ts";
import type { Network } from "./network.ts";
import { readOwnedStorage, readStorageType } from "./shared/lib/storage-control/chain.ts";
import { suiRpcTransport } from "./sui-rpc.ts";

export async function readWalletStorage(network: Network, address: string): Promise<StorageRead> {
  const client = new SuiJsonRpcClient({ network, transport: suiRpcTransport(network) });
  const walrus = network === "mainnet" ? MAINNET_WALRUS_PACKAGE_CONFIG : TESTNET_WALRUS_PACKAGE_CONFIG;
  const [type, window] = await Promise.all([
    readStorageType(client, walrus.systemObjectId),
    extendReads(network).readWindow(),
  ]);
  const items = await readOwnedStorage(client, address, type);
  return { items, currentEpoch: window?.clock.current ?? null };
}

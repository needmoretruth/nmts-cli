import type { StorageRead } from "./storage-control/list.ts";
import type { Network } from "./network.ts";
export declare function readWalletStorage(network: Network, address: string): Promise<StorageRead>;

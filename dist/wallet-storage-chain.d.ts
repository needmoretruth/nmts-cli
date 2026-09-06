import type { StorageRead } from "./commands/wallet-storage.ts";
import type { Network } from "./network.ts";
export declare function readWalletStorage(network: Network, address: string): Promise<StorageRead>;

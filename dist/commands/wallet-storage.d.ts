import { type Network } from "../network.ts";
import { type StorageRead } from "../storage-control.ts";
export type { StorageRead } from "../storage-control.ts";
export { formatBytes } from "../storage-control.ts";
export interface WalletStorageOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. Rejects when the chain could not be read. */
    readStorage?: (network: Network, address: string) => Promise<StorageRead>;
}
export declare function walletStorage(options?: WalletStorageOptions): Promise<number>;

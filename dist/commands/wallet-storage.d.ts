import { type Network } from "../network.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
/** What the chain said: the resources, and which epoch it is (null when the clock could not be read). */
export interface StorageRead {
    items: readonly StorageResource[];
    currentEpoch: number | null;
}
export interface WalletStorageOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. Rejects when the chain could not be read. */
    readStorage?: (network: Network, address: string) => Promise<StorageRead>;
}
export declare function walletStorage(options?: WalletStorageOptions): Promise<number>;
/** Bytes for a person: binary units, two decimals, whole bytes below a KiB. */
export declare function formatBytes(bytes: number): string;

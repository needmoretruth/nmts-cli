import { type Network } from "../network.ts";
import { type StorageOpsReads } from "../storage-control-chain.ts";
import type { SignStorageOp } from "../wallet-sign.ts";
export type StorageOp = "split" | "merge" | "transfer";
export interface StorageOpsOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    yes?: boolean;
    dryRun?: boolean;
    /** `split --size <bytes|KiB|MiB|GiB>`: what the named resource keeps; the rest becomes a new one. */
    size?: string | undefined;
    /** `split --epochs <n>`: how many epochs, from its start, the named resource keeps. */
    epochs?: string | undefined;
    now?: number;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. */
    storageReads?: (network: Network) => StorageOpsReads;
    /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
    signStorage?: SignStorageOp;
}
export declare function walletStorageOps(op: StorageOp, rest: readonly string[], options?: StorageOpsOptions): Promise<number>;
/** "500MiB", "1GiB", "4096" — bytes, in binary units, the way the listing prints them. */
export declare function parseBytes(text: string): number;

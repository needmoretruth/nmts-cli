import { Transaction } from "@mysten/sui/transactions";
import type { Network } from "./network.ts";
import type { StorageRead } from "./commands/wallet-storage.ts";
export type StorageOpShape = {
    kind: "splitSize";
    objectId: string;
    keepBytes: number;
} | {
    kind: "splitEpoch";
    objectId: string;
    splitEpoch: number;
} | {
    kind: "fuse";
    first: string;
    second: string;
    how: "amount" | "periods";
} | {
    kind: "transfer";
    objectId: string;
    to: string;
};
/** The transaction one shape is, for `sender`. */
export declare function storageOpTransaction(shape: StorageOpShape, input: {
    walrusPackageId: string;
    sender: string;
}): Transaction;
/** What the dry run said: a fee, or the chain's own reason for refusing. */
export interface DryRunVerdict {
    feeMist: bigint | null;
    refusal: string | null;
}
/** What the command reads before it prints a review, and the seam a test replaces. */
export interface StorageOpsReads {
    readStorage(address: string): Promise<StorageRead>;
    walrusPackageId(): Promise<string>;
    dryRun(shape: StorageOpShape, sender: string): Promise<DryRunVerdict>;
}
export declare function storageOpsReads(network: Network): StorageOpsReads;

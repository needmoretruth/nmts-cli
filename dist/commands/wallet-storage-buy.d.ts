import { type BuySeams } from "../storage-control.ts";
import type { SignStorageOp } from "../wallet-sign.ts";
export interface StorageBuyOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    yes?: boolean;
    dryRun?: boolean;
    /** `--size <bytes|KiB|MiB|GiB>`: the resource's size, encoded bytes as the listing shows them. */
    size?: string | undefined;
    /** `--epochs <n>`: the term, from the current epoch. Default 2. */
    epochs?: string | undefined;
    /** `--wallet N`: which wallet pays and receives it, this run only. */
    wallet?: string | undefined;
    now?: number;
    /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
    readActiveWallet?: () => Promise<number>;
    buyReads?: BuySeams["reads"];
    signStorage?: SignStorageOp;
}
export declare function walletStorageBuy(options?: StorageBuyOptions): Promise<number>;

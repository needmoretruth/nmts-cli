import type { ExtendReads, SignExtension } from "../extend-plan.ts";
export interface StorageExtendOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    yes?: boolean;
    dryRun?: boolean;
    /** `--force`: extend files that are not near their end yet too. */
    force?: boolean;
    /** `--delegation-file <file>`: the user's delegation token, read from that file. */
    delegationFile?: string | undefined;
    /** `--epochs <n>`: added to each file. Default 2. */
    epochs?: string | undefined;
    /** `--wallet N`: which of this key's wallets pays, this run only. */
    wallet?: string | undefined;
    now?: number;
    /** ⚠ SEAMS, NOT OPTIONS — no flag reaches them. */
    readActiveWallet?: () => Promise<number>;
    readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
    sign?: SignExtension | undefined;
}
export declare function walletStorageExtend(items: readonly string[], options?: StorageExtendOptions): Promise<number>;

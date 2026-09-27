import { type StorageTier } from "../shared/lib/storage-tier.ts";
/** Who pays, or a refusal for a payer this tool does not know. */
export declare function payerOf(pay: string | undefined): "credits" | "wallet";
/** The options that only mean something when the wallet pays, refused when it does not. */
export declare function refuseWalletOnlyOptions(options: {
    epochs?: string | number | undefined;
    storage?: string | undefined;
    wallet?: string | undefined;
    trustServerTipAddress?: boolean;
    from?: string | undefined;
}): void;
/** What NMTS Heavy adds to an upload command line: the tier, and the self-paid knobs. */
export interface HeavyFlags {
    /** `--tier standard|heavy`. Absent = standard. */
    tier?: string | undefined;
    /** `--tier heavy --pay evm`: how many copies, 1..12 (default 2). */
    copies?: string | undefined;
    /** `--tier heavy --pay evm`: which storage companies, by id, comma-separated. */
    providers?: string | undefined;
    /** `--tier heavy --pay evm`: which of this key's EVM wallets pays. Absent = 0. */
    evmWallet?: string | undefined;
    /** `--tier heavy --pay wallet`: how many days to keep it, 1..365 (default 28). */
    days?: string | undefined;
}
/**
 * Which tier this upload goes to — the same reader the browser and the SDK use — and a refusal for
 * every option that means nothing on that tier. Decided before a file is measured.
 */
export declare function tierOf(options: HeavyFlags & {
    pay?: string | undefined;
}): StorageTier;

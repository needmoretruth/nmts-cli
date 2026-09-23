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

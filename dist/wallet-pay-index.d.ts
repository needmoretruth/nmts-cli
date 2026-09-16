export interface PayingWalletInput {
    server?: string | undefined;
    network?: string | undefined;
    /** `--wallet N` — this run only, and it never writes the account's choice. */
    wallet?: string | undefined;
    /**
     * ⚠ A SEAM, NOT AN OPTION: how the account's number is read. No flag reaches it. It exists
     *   because the alternative is a test that signs in and reads a live file list to check that a
     *   review was printed.
     */
    readActiveWallet?: () => Promise<number>;
}
/**
 * A wallet number as a person typed it.
 *
 * ⛔ REFUSED, NEVER ROUNDED. `--wallet 1.5` and `--wallet -1` are command lines to correct; taking
 *    either of them to a neighbouring wallet would spend from an address nobody named.
 */
export declare function walletIndexOf(raw: string): number;
/** Which wallet this run pays from: the flag if it was given, otherwise the account's own number. */
export declare function payingWalletIndex(input: PayingWalletInput): Promise<number>;

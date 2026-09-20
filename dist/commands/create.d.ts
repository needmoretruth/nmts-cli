import type { WalletOpener } from "../openers.ts";
export interface CreateOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** A file to write the new NMTS key into, instead of printing it. Never overwritten. */
    out?: string | undefined;
    /** The Terms of Service version a PERSON read and accepts for the new account. */
    acceptTerms?: string | undefined;
    /** The Privacy Policy version accepted in the same act. */
    acceptPrivacy?: string | undefined;
    /**
     * Link path only: print the address and stop, instead of waiting for a person to use it.
     *
     * ⚠ IT DOES NOTHING ON THE KEY PATH, because there is nothing to wait for there — the account
     *   exists by the time that path prints anything.
     */
    noWait?: boolean | undefined;
    /**
     * `--wallet`: attach this wallet to the account once it exists, so it opens it from then on.
     *
     * ⛔ THE ROOT IS STILL A RANDOM NMTS KEY — the account is made exactly as it is without this,
     *    and the wallet becomes a second way in rather than the account's origin. That is what lets
     *    the wallet be swapped, added to or removed later.
     */
    wallet?: WalletOpener | undefined;
    write?: (line: string) => void;
}
export declare function create(options?: CreateOptions): Promise<number>;

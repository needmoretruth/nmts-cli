import type { WalletOpener } from "../openers.ts";
export interface CreateLinkOptions {
    server: string;
    network: string;
    out?: string | undefined;
    json?: boolean;
    /** Print the address and stop, instead of waiting for somebody to use it. */
    noWait?: boolean | undefined;
    write?: ((line: string) => void) | undefined;
    /**
     * `--wallet`: attach this wallet once a PERSON has finished the account in a browser.
     *
     * ⛔ THERE IS NOTHING TO ATTACH TO BEFORE THEN. The account does not exist while the address is
     *    unused, so this happens at the end of the wait — and a `--no-wait` run, which returns
     *    before a person has been, says so rather than attaching to nothing.
     */
    wallet?: WalletOpener | undefined;
}
export declare function createThroughLink(options: CreateLinkOptions): Promise<number>;

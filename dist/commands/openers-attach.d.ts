import { type AttachedWallet, type WalletOpener } from "../openers.ts";
/** What attaching to a fresh account takes. */
export interface AttachInput {
    server: string;
    /** The account's NMTS key — made in this run and held by nobody else. */
    code: string;
    wallet: WalletOpener;
}
/** What it did, and the one thing that can be left behind by a failure. */
export interface AttachOutcome extends AttachedWallet {
    /**
     * The id of the borrowed key this run could NOT revoke, or null when nothing was left.
     *
     * ⚠ NOT A FAILURE OF THE ATTACH. The wallet does open the account; what did not happen is the
     *   tidying, and a person can cut the key from a browser or with `nmts key revoke`.
     */
    keyLeft: string | null;
}
/** Attach `wallet` to the account `code` opens, borrowing a credential for the length of one PUT. */
export declare function attachWalletToNewAccount(input: AttachInput): Promise<AttachOutcome>;
/**
 * Ask, before an account is made, whether this wallet already opens one.
 *
 * ⛔ THE ONE STEP THAT HAS TO HAPPEN EARLY. Everywhere else a taken locator is a refusal and
 *    nothing else; on `nmts create --wallet` it would be an account that exists, holds a key the
 *    person has been handed, and cannot have the wallet they asked for. One signature spent here
 *    is cheaper than an account nobody wanted.
 */
export declare function refuseIfWalletIsTaken(server: string, wallet: WalletOpener): Promise<void>;
/**
 * What a wallet attached to a new account means, said after the code has been handed over.
 *
 * ⚠ Copy facts — both sentences. Facts for the first: this wallet now opens this account from any
 *   machine, so whoever holds it can read every file in it, and `nmts openers remove <locator>`
 *   takes it off. For the second: a write-scoped key borrowed for this one step is still live on
 *   the brand-new account, and its id is how to cut it.
 */
export declare function sayWalletAttached(say: (line: string) => void, attached: AttachOutcome): void;

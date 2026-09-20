import { type ListEditInput } from "./manifest-write.ts";
/** What the erasing underneath takes: where to talk, what opens the list, and whose list it is. */
export interface EraseInput extends ListEditInput {
    /**
     * The account code's own proof for this one run, base64url — what the two permanent doors ask
     * for beside the credential (`x-nmts-account-proof`).
     *
     * ⛔ BUILT BY THE CALLER AND KEPT BY NOBODY. It is not the NMTS key and opens no file; what it
     *    proves is possession of the code, which is exactly the question these two doors ask.
     */
    accountProof: string;
}
export interface EraseOptions {
    /** Also destroy the treasury's storage under credit-paid files, before erasing them. */
    releaseStorage?: boolean;
}
/** One thing this run acts on: its id, and where it sits in the list as it was read. */
export interface ErasePath {
    id: string;
    path: string;
}
/** What one run will destroy, worked out before anything is sent. */
export interface ErasePlan {
    /** Every FILE going: the ones named, and every file under a folder that was named. */
    readonly files: readonly ErasePath[];
    /**
     * The ids leaving the sealed list — the files above and the folders that were named.
     *
     * ⚠ WIDER THAN `files` ON PURPOSE. A named folder has no server row of its own, so nothing is
     *   erased for it; its entry still has to go, or the list keeps a folder whose contents are gone.
     */
    readonly going: readonly string[];
}
/** What one file's storage release came back with. */
export interface StorageRelease {
    path: string;
    released: number;
    alreadyReleased: number;
    failed: number;
    /**
     * Credits the release actually cost, and where they came from.
     *
     * ⛔ TWO FIELDS, NOT ONE, because "it cost nothing" and "it cost nothing OUT OF THE BALANCE" are
     *    different answers and only one of them is true. A release paid out of the file's own
     *    deposit charges the balance nothing; a file with no deposit pays twice the fee from the
     *    balance, and somebody watching their credits needs to be able to tell which happened.
     */
    feeCredits: number;
    fromDeposit: boolean;
    /** The server's typed refusal when the storage was not the treasury's to destroy. */
    refused: string | null;
}
/** What one run did. */
export interface EraseOutcome {
    /** How many server rows went. Lower than what was asked for when one was already gone. */
    erased: number;
    /** The files it acted on, with the paths they had. */
    files: ErasePath[];
    /** One per file whose storage was asked about — empty unless `releaseStorage` was asked for. */
    releases: StorageRelease[];
    /** The version of the sealed list after the entries left it. */
    seq: number;
}
/**
 * Work out what erasing these paths would destroy, without destroying anything.
 *
 * ⛔ ITS OWN STEP BECAUSE ONE CALLER HAS TO SHOW THE LIST BEFORE IT ASKS. `nmts erase` prints every
 *    file it is about to destroy and then waits for a typed sentence; folding this into the act
 *    would leave the terminal with nothing to print, and reading the list twice would leave the
 *    two reads free to disagree about what is in it.
 */
export declare function planErase(input: ListEditInput, paths: readonly string[]): Promise<ErasePlan>;
/**
 * Destroy what the plan names. ⛔ Irreversible, and nothing below asks whether the caller meant it.
 */
export declare function eraseFiles(input: EraseInput, plan: ErasePlan, options?: EraseOptions): Promise<EraseOutcome>;
/**
 * Resolve these paths and destroy what they name, in one call.
 *
 * ⚠ FOR A CALLER THAT HAS ALREADY DECIDED. Anything that shows a person what is about to go should
 *   use `planErase` first, so what it shows is what it then destroys.
 */
export declare function erasePaths(input: EraseInput, paths: readonly string[], options?: EraseOptions): Promise<EraseOutcome>;

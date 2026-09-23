export interface BalanceOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
/** What the narrow read answers. Everything is optional here because a server may be older. */
export interface Summary {
    credits: {
        remaining: number;
        soonest_expiry: string | null;
        file_cap: number;
        daily_cap: number;
        held: number;
        deposits: number;
        /**
         * The deposit's two numbers, as the SERVER states them: the most one file may set aside, and
         * what a file sets aside when nobody chose.
         *
         * ⛔ READ FROM THE ACCOUNT VIEW, NOT FROM A CONSTANT HERE, for the same reason the two
         *    ceilings above are: this build can be older than the server, and a number printed from a
         *    constant would be this tool's opinion rather than what the ledger will actually do.
         */
        deposit_max: number;
        deposit_default: number;
    };
    quota: {
        granted: number;
        used: number;
    };
    storage: {
        parts: number;
        earliest_expiry_epoch: number | null;
    };
    terms: {
        acceptance_required: boolean;
    };
    /**
     * Whether this account was made UNDER another one — an AI account.
     *
     * ⛔ IT RIDES HERE BECAUSE THIS IS THE ONLY ACCOUNT VIEW A KEY CAN REACH. `whoami` would be the
     *    obvious home, and it cannot have it: that command answers with no server and no API key at
     *    all, so a fact only the server holds is one it can never print without becoming a different
     *    command. A server that predates the field says nothing, which reads as `false` — the state
     *    every account was in before AI accounts existed.
     */
    ai_account: boolean;
    /**
     * Whether this account asks its uploads to carry the recovery list into the storage network.
     *
     * ⛔ IT SAYS WHAT WAS ASKED FOR, NOT WHAT EXISTS. The switch is an intention; whether a copy is
     *    out there is a different fact this read does not carry.
     *
     * ⚠ A SERVER THAT PREDATES THE FIELD READS AS `false`, which is indistinguishable from a switch
     *   that is off. What reads it (`put --pay wallet`'s review) only ADDS a sentence when it is on,
     *   so the older server's answer costs a sentence and never states something untrue.
     */
    network_copy: boolean;
    /** One row per stored file that has a deposit: what it set aside, and what has been spent of it. */
    deposits: DepositRow[];
}
/** One file's deposit, as the account view lists it. */
interface DepositRow {
    deposit_credits: number;
    spent_credits: number;
}
/**
 * The narrow account read, typed — for the other commands that need one number out of it.
 *
 * ⛔ ONE READER OF THIS ROUTE. A second command that narrowed the answer itself would be a second
 *    opinion about which fields a server is allowed to be missing.
 */
export declare function readAccountSummary(server: string, apiKey: string): Promise<Summary>;
export declare function balance(options?: BalanceOptions): Promise<number>;
export {};

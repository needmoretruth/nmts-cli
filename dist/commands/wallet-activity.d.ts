import { type Network } from "../network.ts";
import { type ActivityContext, type ChainTransaction } from "../shared/lib/wallet/activity.ts";
/** How many to ask for, and how many to print after the merge. */
export declare const FETCH = 25;
export declare const SHOW = 20;
/** The list the chain answers with, newest first. */
export interface ActivityFetch {
    transactions: readonly ChainTransaction[];
    /**
     * False when the history could not be read to the end — the node keeps a few weeks and the older
     * part comes from Sui's GraphQL service, which may not answer. Absent counts as true.
     */
    complete?: boolean;
}
export interface WalletActivityOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /**
     * Where the transactions come from.
     *
     * ⚠ A SEAM, NOT AN OPTION: no flag reaches it. A test that talked to a live chain could not run
     *   offline and could never be asked to fail on purpose.
     */
    queryChain?: (network: Network, address: string) => Promise<ActivityFetch>;
}
/** What the judgement compares against on this network. Donation and pool addresses: unknown here. */
export declare function activityContext(network: Network, address: string): ActivityContext;
export declare function walletActivity(options?: WalletActivityOptions): Promise<number>;

import { type Network } from "../network.ts";
import { type ActivityContext, type RpcTransaction } from "../shared/lib/wallet/activity.ts";
/** How many to ask for in each direction, and how many to print after the merge. */
export declare const FETCH_PER_DIRECTION = 25;
export declare const SHOW = 20;
/** The two lists the chain answers with. */
export interface ActivityFetch {
    sent: readonly RpcTransaction[];
    received: readonly RpcTransaction[];
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

import type { ActivityFetch } from "./commands/wallet-activity.ts";
import type { Network } from "./network.ts";
/** How long the two questions get together. A read that stalls is a read that failed. */
export declare const ACTIVITY_TIMEOUT_MS = 20000;
export declare function queryActivity(network: Network, address: string): Promise<ActivityFetch>;

import type { Network } from "./network.ts";
/** How long the question gets. A read that stalls is a read that failed. */
export declare const HISTORY_TIMEOUT_MS = 20000;
export declare function hasHistory(network: Network, address: string): Promise<boolean>;

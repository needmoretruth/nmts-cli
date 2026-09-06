import type { Network } from "./network.ts";
import type { ChainReader } from "./wallet.ts";
/**
 * How long one balance question gets.
 *
 * A read that stalls is a read that failed, and the caller has something honest to print either
 * way. Long enough for a slow public node, short enough that an agent waiting on this does not
 * conclude the tool has hung.
 */
export declare const BALANCE_TIMEOUT_MS = 20000;
/**
 * Read balances for one address on one network.
 *
 * ⚠ THE NODE IS NOT TRUSTED WITH ANYTHING, and it does not have to be: what it answers is printed
 *   as a number and nothing is decided on it. A node that lies about a balance produces a wrong
 *   number on a screen — where its owner will see it disagree with every other wallet they own —
 *   and it cannot produce a wrong address, because the address never came from it.
 */
export declare function chainReader(network: Network, address: string): ChainReader;

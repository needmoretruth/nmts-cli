/**
 * How many unused wallets in a row end the walk.
 *
 * ⛔ TWENTY, THE SAME NUMBER EVERY OTHER WALLET USES. Somebody who has funded a wallet in another
 *    tool and comes looking for it here has been taught what a scan finds by that tool; a different
 *    number here would make the same key look like it holds different wallets in two programs.
 */
export declare const WALLET_SCAN_GAP = 20;
/** What a walk found: the wallets that are in use, lowest first, and how many were asked about. */
export interface WalletScan {
    /** Every index the probe said was in use, ascending. */
    readonly used: readonly number[];
    /** How many times the probe was called — what the walk cost, in questions. */
    readonly scanned: number;
}
/**
 * Is this wallet IN USE? Answered by the caller, because what counts as "in use" is a question
 * about a chain and this file has none: a balance in either coin, or any transaction the address
 * has ever been in.
 *
 * ⚠ A PROBE THAT FAILS SHOULD THROW, not answer `false`. "Nobody could ask" and "nothing is there"
 *   are opposite facts, and answering the second for the first would quietly end the walk early and
 *   report a wallet with money in it as one that does not exist.
 */
export type WalletProbe = (index: number) => Promise<boolean>;
/**
 * Walk the wallets of one NMTS key from 0 upwards, and stop when the walk has learned enough.
 *
 * TWO RULES, AND THEY ARE DIFFERENT RULES:
 *   · every wallet the account has already MADE is asked about, whatever the answers are. Those
 *     wallets are on the person's screen; a walk that skipped one because its neighbour was empty
 *     would be reporting about a wallet it never asked about.
 *   · past those, the walk keeps going as long as it keeps finding wallets in use, and ends after
 *     `gap` unused ones in a row.
 *
 * ⚠ THE RUN CARRIES OVER from the made wallets into the walk past them. A list of thirty wallets
 *   nobody ever funded is thirty unused answers, and starting the count again at the end of it
 *   would ask for twenty more that nobody has any reason to expect anything from.
 */
export declare function discoverWallets(probe: WalletProbe, { count, gap }: {
    count: number;
    gap?: number;
}): Promise<WalletScan>;
/**
 * How far a walk can reach as it stands — the number a progress line counts towards.
 *
 * ⛔ IT MOVES, because the walk's end moves: finding a wallet in use buys another `gap` questions
 *    past it. A progress line drawn against the number the walk STARTED with would sit at "20/20"
 *    while the walk kept going, which reads as a screen that has stopped answering.
 */
export declare function walletScanReach({ count, gap }: {
    count: number;
    gap?: number;
}, highestUsed: number | null): number;

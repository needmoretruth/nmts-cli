import type { AccountSettings } from "./shared/lib/drive/manifest-settings.ts";
export declare const DEPOSIT_CREDITS_MAX = 64;
export declare const DEPOSIT_CREDITS_DEFAULT = 64;
/**
 * What `--deposit <n>` asked for, or undefined when it was not given.
 *
 * ⛔ WHOLE CREDITS ONLY. A deposit is a number of credits the ledger moves, and there is no such
 *    thing as half of one; `--deposit 1.5` is refused rather than rounded, because rounding picks
 *    an amount for somebody who was already being specific.
 */
export declare function parseDeposit(asked: string | number | undefined): number | undefined;
/** The account's own default: what the sealed list holds, or `DEPOSIT_CREDITS_DEFAULT`. */
export declare function depositDefaultOf(settings: AccountSettings | undefined): number;
/** ⛔ The wallet buys its own storage, so there is no treasury deposit to set aside against it. */
export declare function refuseDepositWithWallet(asked: string | number | undefined): void;
/**
 * What the price says about the deposit, under the line that names the credits.
 *
 * ⚠ ONE SENTENCE FOR 0 AND NONE OF THE USUAL HEDGING. It is the one answer whose cost lands later
 *   and somewhere else — on a release, out of the balance — so it is said where the choice shows.
 *
 * `files` is how many files this run puts the deposit on: absent for one file, a count for a
 * directory, where the number set aside is per file and the total is what the balance must cover.
 */
export declare function depositLines(credits: number, files?: number): string[];

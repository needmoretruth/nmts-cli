import { type AccountSettings } from "./manifest-settings.ts";
/** Folds a deposit patch into a settings copy: out-of-range is clamped, the full deposit clears. */
export declare function applyDepositPatch(next: AccountSettings, depositDefault?: number): void;
/** Folds a tip patch into a settings copy: 0 clears, above the cap is capped, fractions are rounded. */
export declare function applyTipPatch(next: AccountSettings, tipTenths?: number, tipConsentAt?: number): void;
/**
 * Folds a wallet patch into a settings copy: out-of-range is clamped, wallet 0 and a list of one
 * clear, and the count is left holding the paying wallet.
 *
 * ⛔ THE COUNT FOLLOWS THE NUMBER, in this one write path. `wallet use 7` on a list of three
 *    wallets means the person is paying from a wallet the screen would not have drawn; raising the
 *    count here is what makes the two facts agree on every device at once, rather than in whichever
 *    screen happens to notice.
 */
export declare function applyWalletPatch(next: AccountSettings, activeWallet?: number, walletCount?: number): void;
/**
 * Which size-padding rule an account seals its next upload under.
 *
 * ⛔ DECLARED BESIDE THE FIELD THAT CARRIES IT, not in `lib/crypto/padding.ts` where the padding
 *    itself lives — `padding.ts` imports it through `manifest-ops.ts`, which re-exports it. The
 *    direction matters: this file is copied byte-for-byte into the `nmts` command-line package,
 *    and a type reaching out of it into the crypto tree would drag that whole tree along with it
 *    for the sake of two string literals.
 */
export type PaddingMode = "padme" | "pow2" | "none";
/**
 * One account-settings edit, as DESIRED STATE per field — never "toggle", so replaying it onto a
 * list another device wrote lands the same answer. A default value means absence in the codec.
 */
export interface SettingsPatch {
    developerMode?: boolean;
    textScalePct?: number;
    /** Which rule seals future uploads: `"padme"` = the default, `"none"` = the file's exact length. */
    paddingMode?: PaddingMode;
    /** Credits held back with each credit-paid upload, 0 to `DEPOSIT_MAX_CREDITS`. */
    depositDefault?: number;
    /** The standing tip in tenths of a percent (0 = none) and the instant its terms were agreed to (0 clears). */
    tipTenths?: number;
    tipConsentAt?: number;
    /** Which wallet pays, by index (0 = the wallet every account starts with). */
    activeWallet?: number;
    /** How many wallets this account's list holds. Raised to hold `activeWallet`, never lowered. */
    walletCount?: number;
}
/**
 * Apply one settings patch, returning new settings. Returns the SAME reference when nothing
 * changed, so callers can skip a save (a version bump every other device must download).
 *
 * A text scale is CLAMPED into the codec's bounds here — this is the one write path, so a value
 * the slider or the typed field lets through never reaches the wire out of range.
 */
export declare function applySettingsPatch(settings: AccountSettings, patch: SettingsPatch): AccountSettings;

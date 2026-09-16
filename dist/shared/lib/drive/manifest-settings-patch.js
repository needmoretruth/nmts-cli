// What a DEVICE writes into the account settings — one edit, as desired state per field.
//
// ⛔ APART FROM `manifest-settings.ts` BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS. That file says
//    what the bytes carry and what a value some other build wrote is worth (out of range is
//    DROPPED — falling back to a default is always safe to read). This one says what happens when
//    a person moves a control here (out of range is CLAMPED — the slider must not be able to write
//    something the codec would then throw away). Mixing the two is how a rule ends up applied on
//    one side only.
//
// ⚠ PUBLISHED — copied byte-for-byte into the `nmts` command-line package, and reached from there
//   through `manifest-ops.ts`, which re-exports everything below.
import { ACTIVE_WALLET_DEFAULT, DEPOSIT_DEFAULT_CREDITS, DEPOSIT_MAX_CREDITS, TEXT_SCALE_DEFAULT_PCT, TEXT_SCALE_MAX_PCT, TEXT_SCALE_MIN_PCT, TIP_TENTHS_MAX, WALLET_COUNT_DEFAULT, WALLET_COUNT_MAX, WALLET_INDEX_LIMIT, walletCountOf, } from "./manifest-settings.js";
/** Folds a deposit patch into a settings copy: out-of-range is clamped, the full deposit clears. */
export function applyDepositPatch(next, depositDefault) {
    if (depositDefault === undefined || !Number.isFinite(depositDefault))
        return;
    const credits = Math.round(Math.min(DEPOSIT_MAX_CREDITS, Math.max(0, depositDefault)));
    if (credits === DEPOSIT_DEFAULT_CREDITS)
        delete next.depositDefault;
    else
        next.depositDefault = credits;
}
/** Folds a tip patch into a settings copy: 0 clears, above the cap is capped, fractions are rounded. */
export function applyTipPatch(next, tipTenths, tipConsentAt) {
    if (tipTenths !== undefined && Number.isFinite(tipTenths)) {
        const t = Math.round(Math.min(TIP_TENTHS_MAX, Math.max(0, tipTenths)));
        if (t === 0)
            delete next.tipTenths;
        else
            next.tipTenths = t;
    }
    if (tipConsentAt !== undefined && Number.isFinite(tipConsentAt)) {
        if (tipConsentAt <= 0)
            delete next.tipConsentAt;
        else
            next.tipConsentAt = Math.round(tipConsentAt);
    }
}
/**
 * Folds a wallet patch into a settings copy: out-of-range is clamped, wallet 0 and a list of one
 * clear, and the count is left holding the paying wallet.
 *
 * ⛔ THE COUNT FOLLOWS THE NUMBER, in this one write path. `wallet use 7` on a list of three
 *    wallets means the person is paying from a wallet the screen would not have drawn; raising the
 *    count here is what makes the two facts agree on every device at once, rather than in whichever
 *    screen happens to notice.
 */
export function applyWalletPatch(next, activeWallet, walletCount) {
    if (activeWallet !== undefined && Number.isFinite(activeWallet)) {
        const index = Math.round(Math.min(WALLET_INDEX_LIMIT - 1, Math.max(0, activeWallet)));
        if (index === ACTIVE_WALLET_DEFAULT)
            delete next.activeWallet;
        else
            next.activeWallet = index;
    }
    if (walletCount !== undefined && Number.isFinite(walletCount)) {
        const count = Math.round(Math.min(WALLET_COUNT_MAX, Math.max(WALLET_COUNT_DEFAULT, walletCount)));
        if (count === WALLET_COUNT_DEFAULT)
            delete next.walletCount;
        else
            next.walletCount = count;
    }
    const counted = walletCountOf(next);
    if (counted === WALLET_COUNT_DEFAULT)
        delete next.walletCount;
    else
        next.walletCount = counted;
}
/**
 * Apply one settings patch, returning new settings. Returns the SAME reference when nothing
 * changed, so callers can skip a save (a version bump every other device must download).
 *
 * A text scale is CLAMPED into the codec's bounds here — this is the one write path, so a value
 * the slider or the typed field lets through never reaches the wire out of range.
 */
export function applySettingsPatch(settings, patch) {
    const next = { ...settings };
    if (patch.developerMode !== undefined) {
        if (patch.developerMode)
            next.developerMode = true;
        else
            delete next.developerMode;
    }
    if (patch.paddingMode !== undefined) {
        // The default is spelled as absence, like every other field here — so two devices that both
        // "choose the default" write the same bytes and neither bumps the list's version.
        if (patch.paddingMode === "pow2" || patch.paddingMode === "none")
            next.paddingMode = patch.paddingMode;
        else
            delete next.paddingMode;
    }
    if (patch.textScalePct !== undefined && Number.isFinite(patch.textScalePct)) {
        const pct = Math.round(Math.min(TEXT_SCALE_MAX_PCT, Math.max(TEXT_SCALE_MIN_PCT, patch.textScalePct)));
        if (pct === TEXT_SCALE_DEFAULT_PCT)
            delete next.textScalePct;
        else
            next.textScalePct = pct;
    }
    applyDepositPatch(next, patch.depositDefault);
    applyTipPatch(next, patch.tipTenths, patch.tipConsentAt);
    applyWalletPatch(next, patch.activeWallet, patch.walletCount);
    const same = (next.developerMode === true) === (settings.developerMode === true) &&
        next.paddingMode === settings.paddingMode && next.depositDefault === settings.depositDefault &&
        next.textScalePct === settings.textScalePct &&
        next.tipTenths === settings.tipTenths &&
        next.tipConsentAt === settings.tipConsentAt &&
        next.activeWallet === settings.activeWallet &&
        next.walletCount === settings.walletCount;
    return same ? settings : next;
}

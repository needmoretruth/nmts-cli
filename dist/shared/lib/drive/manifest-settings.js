// The account-level settings that ride inside the sealed file list, and how they travel.
//
// ⛔ THEY ARE IN THE SEALED LIST BECAUSE THE SERVER MUST NOT LEARN THEM. Each one would otherwise
//    be a small per-account fingerprint a server could keep, and each follows the account rather
//    than the device, so two machines behave the same way for one person.
//
// ⛔ A SETTING IS NOT SAVED BECAUSE IT IS DECLARED — it is saved because both functions below name
//    it. One shipped declared, written by its own screen and read by the uploader, and carried by
//    NEITHER direction: every save dropped it silently, on every device, and the test standing
//    beside it listed the fields it checked and so could only check what somebody remembered to
//    list. That test is now typed so a field added here and not added there does not compile.
/** The sanity bounds a stored text scale must sit in to be USED. One place; codec and UI agree. */
export const TEXT_SCALE_MIN_PCT = 80;
export const TEXT_SCALE_MAX_PCT = 160;
/** Follow the device. Not written to the wire — absence is the only spelling of it. */
export const TEXT_SCALE_DEFAULT_PCT = 100;
/** The most a standing tip can be: the whole payment. Above the dial's 10 % it is typed and confirmed. */
export const TIP_TENTHS_MAX = 1000;
/**
 * The deposit range this format carries: whole credits, 0 to 64.
 *
 * ⚠ The SERVER's own ceiling rides on the account view (`deposit_max`) and is what the payment
 * screen holds the chosen figure inside. This pair is the format's bound, so a value written by
 * some other build is read back only when it is one this build can also write.
 */
export const DEPOSIT_MAX_CREDITS = 64;
/** What an account's deposit is when nobody chose. Not written to the wire — absence spells it. */
export const DEPOSIT_DEFAULT_CREDITS = DEPOSIT_MAX_CREDITS;
/** The default deposit in force for an account, in credits. Absence is the full deposit, not 0. */
export function depositDefaultOf(settings) {
    const stored = settings?.depositDefault;
    return typeof stored === "number" ? stored : DEPOSIT_DEFAULT_CREDITS;
}
/** Settings → wire, or null when every field is at its default (then nothing is written). */
export function settingsToWire(s) {
    if (!s)
        return null;
    const w = {};
    if (s.developerMode)
        w.dm = 1;
    if (typeof s.textScalePct === "number" &&
        Number.isFinite(s.textScalePct) &&
        s.textScalePct !== TEXT_SCALE_DEFAULT_PCT &&
        s.textScalePct >= TEXT_SCALE_MIN_PCT &&
        s.textScalePct <= TEXT_SCALE_MAX_PCT) {
        w.tx = Math.round(s.textScalePct);
    }
    if (s.paddingMode === "pow2" || s.paddingMode === "none")
        w.pd = s.paddingMode;
    if (typeof s.depositDefault === "number" &&
        Number.isInteger(s.depositDefault) &&
        s.depositDefault >= 0 &&
        s.depositDefault < DEPOSIT_MAX_CREDITS) {
        w.dd = s.depositDefault;
    }
    if (typeof s.tipTenths === "number" && Number.isInteger(s.tipTenths) && s.tipTenths > 0 && s.tipTenths <= TIP_TENTHS_MAX) {
        w.tp = s.tipTenths;
    }
    if (typeof s.tipConsentAt === "number" && Number.isFinite(s.tipConsentAt) && s.tipConsentAt > 0) {
        w.tc = Math.round(s.tipConsentAt);
    }
    return w.dm !== undefined ||
        w.tx !== undefined ||
        w.pd !== undefined ||
        w.dd !== undefined ||
        w.tp !== undefined ||
        w.tc !== undefined
        ? w
        : null;
}
/**
 * Wire → settings, dropping anything unusable. A text scale outside the bounds is DROPPED, not
 * clamped: rendering a whole app at a number some other build miswrote is worse than falling back
 * to the device's own size, which is always readable.
 */
export function settingsFromWire(w) {
    if (!w || typeof w !== "object")
        return undefined;
    // Read field by field rather than asserting the shape: this arrives from a sealed blob some
    // other build wrote, and every field below is checked before it is used anyway.
    const dm = Reflect.get(w, "dm");
    const tx = Reflect.get(w, "tx");
    const pd = Reflect.get(w, "pd");
    const dd = Reflect.get(w, "dd");
    const tp = Reflect.get(w, "tp");
    const tc = Reflect.get(w, "tc");
    const s = {};
    if (dm === 1)
        s.developerMode = true;
    if (typeof tx === "number" &&
        Number.isFinite(tx) &&
        tx !== TEXT_SCALE_DEFAULT_PCT &&
        tx >= TEXT_SCALE_MIN_PCT &&
        tx <= TEXT_SCALE_MAX_PCT) {
        s.textScalePct = Math.round(tx);
    }
    // An unknown rule is DROPPED, not guessed at: padding a file by a rule this build does not know
    // would give it a size no reader here can undo. Falling back to the default is always readable.
    if (pd === "pow2" || pd === "none")
        s.paddingMode = pd;
    // A deposit outside the range is DROPPED, not clamped: holding back a number some other build
    // miswrote is worse than holding back the full deposit, which is what every account starts at.
    if (typeof dd === "number" && Number.isInteger(dd) && dd >= 0 && dd < DEPOSIT_MAX_CREDITS) {
        s.depositDefault = dd;
    }
    // A tip outside the bounds is DROPPED, not clamped: sending a share some other build miswrote is
    // worse than sending nothing, which is always what 0 means.
    if (typeof tp === "number" && Number.isInteger(tp) && tp > 0 && tp <= TIP_TENTHS_MAX)
        s.tipTenths = tp;
    if (typeof tc === "number" && Number.isFinite(tc) && tc > 0)
        s.tipConsentAt = Math.round(tc);
    return s.developerMode !== undefined ||
        s.textScalePct !== undefined ||
        s.paddingMode !== undefined ||
        s.depositDefault !== undefined ||
        s.tipTenths !== undefined ||
        s.tipConsentAt !== undefined
        ? s
        : undefined;
}
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

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
    if (s.paddingMode === "pow2")
        w.pd = "pow2";
    return w.dm !== undefined || w.tx !== undefined || w.pd !== undefined ? w : null;
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
    if (pd === "pow2")
        s.paddingMode = "pow2";
    return s.developerMode !== undefined || s.textScalePct !== undefined || s.paddingMode !== undefined
        ? s
        : undefined;
}

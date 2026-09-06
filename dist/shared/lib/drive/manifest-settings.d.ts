export interface AccountSettings {
    /** Developer mode — technical storage facts + ciphertext links in the file detail. Absent = off. */
    developerMode?: true;
    /**
     * In-app text size, percent of the DEVICE's own size. Absent = 100 = follow the device. Never a
     * pixel value: the device's own accessibility setting stays underneath, and this multiplies it.
     */
    textScalePct?: number;
    /**
     * SIZE PADDING rule — how coarsely a file's stored size is rounded up.
     *
     * Absent = Padmé, the default: about 32 possible sizes per doubling, ~1% more storage.
     * `"pow2"` rounds to the next power of two: one size per doubling, ~39% more storage. Those are
     * the only two, and there is deliberately no "off" — the owner's choice was between two rules,
     * and switching padding off would mean "this account's files still state their exact size".
     *
     * Here, in the sealed list, for the same reason the other two are: the server must not learn it
     * (it would be a per-account fingerprint the server could hold on to), and it
     * follows the account rather than the device, so a phone and a laptop pad the same way.
     *
     * ⚠ It applies to what is uploaded NEXT. Bytes already on the storage network cannot be
     * re-padded, and the screen says so.
     */
    paddingMode?: "pow2";
    /**
     * STANDING TIP — the share of every storage payment sent to the developer as a gift, in tenths
     * of a percent (25 = 2.5 %). Absent = 0 = nothing is sent. Set by the person, once, on the
     * wallet screen or with the CLI; from then on every payment sends it without a question, in
     * the coin just paid (WAL).
     */
    tipTenths?: number;
    /**
     * When the person first agreed to the gift terms (voluntary · nothing in return · not refundable
     * · goes to the published address · visible on the chain), as a UTC millisecond instant. Absent
     * = never agreed: raising the tip above 0 asks for that agreement once, and later changes do not.
     */
    tipConsentAt?: number;
}
/** The sanity bounds a stored text scale must sit in to be USED. One place; codec and UI agree. */
export declare const TEXT_SCALE_MIN_PCT = 80;
export declare const TEXT_SCALE_MAX_PCT = 160;
/** Follow the device. Not written to the wire — absence is the only spelling of it. */
export declare const TEXT_SCALE_DEFAULT_PCT = 100;
export interface WireSettings {
    /** developerMode. */
    dm?: 1;
    /** textScalePct. */
    tx?: number;
    /**
     * paddingMode, present only for the non-default rule.
     *
     * ⛔ ADDED 2026-08-24 AFTER MEASURING THAT IT WAS MISSING. The setting existed on
     * `AccountSettings`, the screen wrote it and the uploader read it — but neither direction of
     * this codec carried it, so every save dropped it and every reload went back to the default.
     * Somebody who chose to pay about 39% more storage to round their file sizes more coarsely got
     * the default rule instead, on every device, silently. A settings field is not saved because it
     * is declared; it is saved because both functions below name it.
     */
    pd?: "pow2";
    /** tipTenths, present only above 0. */
    tp?: number;
    /** tipConsentAt. */
    tc?: number;
}
/** The most a standing tip can be: the whole payment. Above the dial's 10 % it is typed and confirmed. */
export declare const TIP_TENTHS_MAX = 1000;
/** Settings → wire, or null when every field is at its default (then nothing is written). */
export declare function settingsToWire(s: AccountSettings | undefined): WireSettings | null;
/**
 * Wire → settings, dropping anything unusable. A text scale outside the bounds is DROPPED, not
 * clamped: rendering a whole app at a number some other build miswrote is worse than falling back
 * to the device's own size, which is always readable.
 */
export declare function settingsFromWire(w: unknown): AccountSettings | undefined;
/** Folds a tip patch into a settings copy: 0 clears, above the cap is capped, fractions are rounded. */
export declare function applyTipPatch(next: AccountSettings, tipTenths?: number, tipConsentAt?: number): void;

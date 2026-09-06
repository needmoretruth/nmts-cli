// Tip arithmetic: what share of a storage payment goes to the developer as a gift. The screen's
// dial and the CLI's setting use the same scale — tenths of a percent — with the dial ending at
// 10 % and anything above typed in and confirmed once more. The payment is in WAL, so the tip is.
//
// The default is 0, and 0 sends nothing. Division rounds down, so nothing ever signs one unit
// more than the screen showed. No network, no React, no translation; `test/tip-math.test.ts`.
/** The dial's right end: 10 %. Above it the value is typed, and confirmed once more. */
export const TIP_DIAL_MAX_TENTHS = 100;
/** No input goes above this: the whole paid amount (100 %). More than that is a separate gift. */
export const TIP_MAX_TENTHS = 1000;
/** Above this the person confirms "this share, permanently" once more. Same as the dial's end. */
export const TIP_CONFIRM_ABOVE_TENTHS = TIP_DIAL_MAX_TENTHS;
/** A typed percent (decimals allowed) to integer tenths 0..1000. Not a number → 0 (send nothing), not an error. */
export function tenthsFromPercent(input) {
    if (!Number.isFinite(input))
        return 0;
    return Math.min(TIP_MAX_TENTHS, Math.max(0, Math.round(input * 10)));
}
/** Tenths → the percent a person reads: 25 → "2.5", 100 → "10". */
export function percentText(tenths) {
    const t = Math.min(TIP_MAX_TENTHS, Math.max(0, Math.round(tenths)));
    return t % 10 === 0 ? String(t / 10) : (t / 10).toFixed(1);
}
/** `tenths`/10 % of the paid amount (base units), rounded down. 0n when nothing was paid or the share is 0. */
export function tipFromTenths(paidBaseUnits, tenths) {
    const t = Math.min(TIP_MAX_TENTHS, Math.max(0, Math.round(tenths)));
    if (paidBaseUnits <= 0n || t === 0 || !Number.isFinite(t))
        return 0n;
    return (paidBaseUnits * BigInt(t)) / 1000n;
}
/** Does this share need the extra confirmation (a value past the dial's end)? */
export function needsExtraConfirm(tenths) {
    return tenths > TIP_CONFIRM_ABOVE_TENTHS;
}

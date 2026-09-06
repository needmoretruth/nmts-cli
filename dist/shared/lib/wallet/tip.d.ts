/** The dial's right end: 10 %. Above it the value is typed, and confirmed once more. */
export declare const TIP_DIAL_MAX_TENTHS = 100;
/** No input goes above this: the whole paid amount (100 %). More than that is a separate gift. */
export declare const TIP_MAX_TENTHS = 1000;
/** Above this the person confirms "this share, permanently" once more. Same as the dial's end. */
export declare const TIP_CONFIRM_ABOVE_TENTHS = 100;
/** A typed percent (decimals allowed) to integer tenths 0..1000. Not a number → 0 (send nothing), not an error. */
export declare function tenthsFromPercent(input: number): number;
/** Tenths → the percent a person reads: 25 → "2.5", 100 → "10". */
export declare function percentText(tenths: number): string;
/** `tenths`/10 % of the paid amount (base units), rounded down. 0n when nothing was paid or the share is 0. */
export declare function tipFromTenths(paidBaseUnits: bigint, tenths: number): bigint;
/** Does this share need the extra confirmation (a value past the dial's end)? */
export declare function needsExtraConfirm(tenths: number): boolean;

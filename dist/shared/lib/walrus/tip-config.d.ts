/**
 * The tip a relay charges, as parsed from its `GET /v1/tip-config`. A relay is free (`none`),
 * flat (`const`), or size-linear (`linear`). `unknown` means the endpoint answered but we could
 * not understand its tip shape — REACHABLE BUT UNUSABLE (scoring gates it out, never guesses a
 * price). All MIST amounts are bigint.
 */
export type RelayTip = {
    readonly kind: "none";
} | {
    readonly kind: "const";
    readonly address: string;
    readonly baseMist: bigint;
} | {
    readonly kind: "linear";
    readonly address: string;
    readonly baseMist: bigint;
    /** MIST added per KiB of ENCODED size (Walrus config `encoded_size_mul_per_kib`). */
    readonly mulPerKibMist: bigint;
} | {
    readonly kind: "unknown";
    readonly detail: string;
};
/**
 * Parse a relay's `/v1/tip-config` JSON into a RelayTip, DEFENSIVELY (an unrecognized/garbled shape
 * becomes `unknown`, never a guessed price). Recognized shapes:
 *   no-tip:  { "no_tip": ... }                                        → none
 *   const:   { "send_tip": { "address", "kind": { "const": N } } }    → const
 *   linear:  { "send_tip": { "address",
 *                            "kind": { "linear": { "base": N,
 *                                                  "encoded_size_mul_per_kib": M } } } } → linear
 * Tolerates a missing `send_tip` wrapper (reads `kind` off the root) and camelCase `sendTip`.
 */
export declare function parseTipConfig(raw: unknown): RelayTip;

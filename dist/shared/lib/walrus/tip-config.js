// A relay's tip, read from its `GET /v1/tip-config`. Kept apart from the relay pool so the
// command-line tool reads a tip with the same parser the browser uses (it copies this file).
/** Coerce a JSON tip amount (number | numeric string | bigint) to a non-negative bigint, or null. */
function toMist(value) {
    if (typeof value === "number")
        return Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
    if (typeof value === "bigint")
        return value >= 0n ? value : null;
    if (typeof value === "string")
        return /^\d+$/.test(value) ? BigInt(value) : null;
    return null;
}
/** The value under `key` when `value` is a JSON object that has it; `undefined` otherwise. */
function field(value, key) {
    return typeof value === "object" && value !== null && key in value ? Reflect.get(value, key) : undefined;
}
function isObject(value) {
    return typeof value === "object" && value !== null;
}
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
export function parseTipConfig(raw) {
    // A no-tip relay answers the bare JSON string "no_tip" (measured on Mysten's relay image v1.60.1,
    // 2026-11-09; the SDK reads any string as "no tip"). Read as an object, a free relay would be
    // "unknown" and could never be chosen.
    if (raw === "no_tip")
        return { kind: "none" };
    if (!isObject(raw)) {
        return { kind: "unknown", detail: "tip-config was not a JSON object" };
    }
    if ("no_tip" in raw || field(raw, "tip") === "no_tip")
        return { kind: "none" };
    const sendTip = field(raw, "send_tip") ?? field(raw, "sendTip");
    const node = isObject(sendTip) ? sendTip : raw;
    const addressValue = field(node, "address");
    const address = typeof addressValue === "string" ? addressValue : "";
    const kind = field(node, "kind");
    if (!isObject(kind)) {
        return { kind: "unknown", detail: "tip-config had no recognizable send_tip.kind" };
    }
    if ("const" in kind) {
        const baseMist = toMist(field(kind, "const"));
        if (baseMist === null)
            return { kind: "unknown", detail: "const tip amount was not a non-negative integer" };
        return { kind: "const", address, baseMist };
    }
    if ("linear" in kind) {
        const linear = field(kind, "linear");
        if (!isObject(linear)) {
            return { kind: "unknown", detail: "linear tip had no body" };
        }
        const baseMist = toMist(field(linear, "base") ?? 0);
        const mulPerKibMist = toMist(field(linear, "encoded_size_mul_per_kib"));
        if (baseMist === null || mulPerKibMist === null) {
            return { kind: "unknown", detail: "linear tip base/encoded_size_mul_per_kib were not non-negative integers" };
        }
        return { kind: "linear", address, baseMist, mulPerKibMist };
    }
    return { kind: "unknown", detail: "unrecognized tip kind (expected const | linear | no_tip)" };
}

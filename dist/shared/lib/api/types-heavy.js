// The wire shapes of NMTS Heavy's order routes, and the refusals they answer with.
//
// ⚠ THIS FILE IS PUBLISHED. It is copied byte-for-byte into the `nmts` command-line package, so it
//   imports nothing and its comments stay self-contained English.
//
// WHAT AN ORDER IS. One upload (one file or fifty) opens ONE order. The order has a slot per sealed
// part; each slot is placed with a Filecoin storage company, the client uploads the bytes to that
// company directly, and the server has the copies committed on chain and reports when they are
// stored. Payment is either credits (taken when the order opens) or the person's wallet (paid once,
// after every slot is stored). The finished parts are then committed to a file like any other part,
// naming the order and slot that paid for them.
//
// ⛔ IDS ARE DECIMAL STRINGS, NOT NUMBERS. Data-set and piece ids are uint256 on chain and can exceed
//    what a JSON number carries exactly, so every id travels as a string and is never parsed.
/**
 * Every refusal the order routes can answer, by the name the contract gives it.
 *
 *   credits_insufficient · idempotency_conflict · file_credits_cap · day_credits_cap ·
 *   heavy_wallet_pay_off · heavy_price_unavailable · unpaid_orders_cap ·
 *   heavy_unavailable                                                  (opening an order)
 *   piece_cid_invalid · piece_size_mismatch · slot_state               (placing a slot)
 *   not_stored · payment_not_found · payment_mismatch · digest_used   (reporting a payment)
 */
export const HEAVY_REFUSALS = [
    "credits_insufficient",
    "idempotency_conflict",
    "file_credits_cap",
    "day_credits_cap",
    "heavy_wallet_pay_off",
    "heavy_price_unavailable",
    "unpaid_orders_cap",
    "heavy_unavailable",
    "piece_cid_invalid",
    "piece_size_mismatch",
    "slot_state",
    "not_stored",
    "payment_not_found",
    "payment_mismatch",
    "digest_used",
];
/**
 * The credit refusals Standard already has, which the order route may answer with instead of a new
 * code of its own. They mean the same thing to the person, so they read as the same refusal here.
 */
const SAME_AS = {
    credits_short: "credits_insufficient",
    credit_file_cap: "file_credits_cap",
    credit_daily_cap: "day_credits_cap",
};
/**
 * The Heavy refusal an error code names, or `null` when it names none.
 *
 * Letter case is ignored: servers spell error codes in capitals (`CREDITS_INSUFFICIENT`) and the
 * contract writes them in lower case, and both mean one thing.
 */
export function heavyRefusalOf(code) {
    const lower = code.toLowerCase();
    const direct = HEAVY_REFUSALS.find((r) => r === lower);
    return direct ?? SAME_AS[lower] ?? null;
}

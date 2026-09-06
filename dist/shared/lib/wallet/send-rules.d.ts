/** Base-unit scale for both tokens (1 SUI = 1e9 MIST, 1 WAL = 1e9 FROST). */
export declare const TOKEN_DECIMALS = 9;
/**
 * SUI kept back so a send or exchange can pay its own gas (0.05 SUI). A ceiling, not the charged
 * amount — a real fee is a few million MIST; this is generous so a send never strands the wallet
 * without gas.
 */
export declare const SUI_GAS_RESERVE_MIST = 50000000n;
/** Which token a send moves. */
export type SendCoin = "SUI" | "WAL";
/** Trim and lowercase an address (hex is case-insensitive; lowercase is the shape kept). */
export declare function normalizeSuiAddress(input: string): string;
/** True when `input`, normalised, is a full 0x + 64-hex Sui address. */
export declare function isValidSuiAddress(input: string): boolean;
/**
 * A decimal amount ("0.5", "12", ".25") as base units, EXACTLY — no floating point, so 0.1 never
 * drifts. Null for anything malformed or finer than the chain keeps (never silently rounded). Does
 * not judge whether the amount is affordable; that is the validator's job.
 */
export declare function parseTokenAmountToBaseUnits(input: string, decimals?: number): bigint | null;
/**
 * The most that can be sent, in base units. SUI keeps the gas reserve back; WAL is fully sendable
 * (a WAL transfer pays its gas in SUI, which the validator checks separately). Never negative.
 */
export declare function maxSendableBaseUnits(params: {
    coin: SendCoin;
    suiBalance: bigint;
    walBalance: bigint;
    gasReserve?: bigint;
}): bigint;
/** Stable error codes for a send. Each maps to one honest sentence on whichever surface shows it. */
export type SendValidationError = "invalidAddress" | "invalidAmount" | "insufficientBalance" | "noGasForWal";
export type SendValidation = {
    ok: true;
    amountBaseUnits: bigint;
    address: string;
} | {
    ok: false;
    error: SendValidationError;
};
/**
 * Validate a send. The address must be a full Sui address; the amount must be above zero and within
 * what can be sent; a WAL send also needs the gas reserve in SUI — else `noGasForWal`.
 */
export declare function validateSendForm(params: {
    coin: SendCoin;
    amountInput: string;
    addressInput: string;
    suiBalance: bigint;
    walBalance: bigint;
    gasReserve?: bigint;
}): SendValidation;
/** The lowest gas budget a person may set: 0.002 SUI. Below it no transaction goes through. */
export declare const GAS_BUDGET_MIN_MIST = 2000000n;
/** The absolute ceiling: 1 SUI. A slipped extra zero stops here. */
export declare const GAS_BUDGET_ABS_MAX_MIST = 1000000000n;
/**
 * The RECOMMENDED gas budget from a measured (dry-run) fee: twice the measurement, at least
 * 0.005 SUI, at most 1 SUI.
 *
 * Why twice: the measurement is taken against this moment's object versions and reference gas
 * price, and both move a little between signing and broadcast. A budget below the real cost makes
 * the transaction FAIL FOR WANT OF GAS, and that gas is gone; the doubling is what buys out that
 * failure. A budget is a ceiling, not a charge — what is not used stays in the wallet.
 */
export declare function recommendedGasBudgetMist(estimateMist: bigint): bigint;
/** Keep a typed gas budget inside the usable range — clamped, not refused. */
export declare function clampGasBudgetMist(n: bigint): bigint;

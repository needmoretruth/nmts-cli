// The rules of sending SUI or WAL out of the wallet — address shape, exact amounts, what can be
// sent, and the gas budget a person may set. ⚠ PUBLISHED — copied byte-for-byte into the `nmts`
// command-line package; keep comments self-contained English.
//
// CONTRACT: every function is pure — no I/O, no side effects, no network, no dates. Validators
//   return a discriminated result carrying a STABLE error CODE (a screen maps codes to sentences);
//   they never throw on bad input and never format for a locale. Base units are 1e9
//   (1 SUI = 1e9 MIST, 1 WAL = 1e9 FROST).
// NON-CUSTODIAL: these helpers only DECIDE amounts and addresses that the person's own wallet then
//   signs; nothing here holds, routes or moves value.

/** Base-unit scale for both tokens (1 SUI = 1e9 MIST, 1 WAL = 1e9 FROST). */
export const TOKEN_DECIMALS = 9;

/**
 * SUI kept back so a send or exchange can pay its own gas (0.05 SUI). A ceiling, not the charged
 * amount — a real fee is a few million MIST; this is generous so a send never strands the wallet
 * without gas.
 */
export const SUI_GAS_RESERVE_MIST = 50_000_000n;

/** Which token a send moves. */
export type SendCoin = "SUI" | "WAL";

/** A full Sui address: `0x` + 64 lowercase hex characters. */
const SUI_ADDRESS_RE = /^0x[0-9a-f]{64}$/;

/** Trim and lowercase an address (hex is case-insensitive; lowercase is the shape kept). */
export function normalizeSuiAddress(input: string): string {
  return input.trim().toLowerCase();
}

/** True when `input`, normalised, is a full 0x + 64-hex Sui address. */
export function isValidSuiAddress(input: string): boolean {
  return SUI_ADDRESS_RE.test(normalizeSuiAddress(input));
}

/**
 * A decimal amount ("0.5", "12", ".25") as base units, EXACTLY — no floating point, so 0.1 never
 * drifts. Null for anything malformed or finer than the chain keeps (never silently rounded). Does
 * not judge whether the amount is affordable; that is the validator's job.
 */
export function parseTokenAmountToBaseUnits(input: string, decimals = TOKEN_DECIMALS): bigint | null {
  const s = input.trim();
  if (s === "" || s === "." || !/^\d*\.?\d*$/.test(s)) return null;
  const [intPart = "", fracPart = ""] = s.split(".");
  if (intPart === "" && fracPart === "") return null;
  if (fracPart.length > decimals) return null;
  const frac = fracPart.padEnd(decimals, "0");
  try {
    return BigInt(`${intPart === "" ? "0" : intPart}${frac}`);
  } catch {
    return null;
  }
}

/**
 * The most that can be sent, in base units. SUI keeps the gas reserve back; WAL is fully sendable
 * (a WAL transfer pays its gas in SUI, which the validator checks separately). Never negative.
 */
export function maxSendableBaseUnits(params: {
  coin: SendCoin;
  suiBalance: bigint;
  walBalance: bigint;
  gasReserve?: bigint;
}): bigint {
  const reserve = params.gasReserve ?? SUI_GAS_RESERVE_MIST;
  if (params.coin === "SUI") {
    const max = params.suiBalance - reserve;
    return max > 0n ? max : 0n;
  }
  return params.walBalance > 0n ? params.walBalance : 0n;
}

/** Stable error codes for a send. Each maps to one honest sentence on whichever surface shows it. */
export type SendValidationError =
  | "invalidAddress"
  | "invalidAmount"
  | "insufficientBalance"
  | "noGasForWal";

export type SendValidation =
  | { ok: true; amountBaseUnits: bigint; address: string }
  | { ok: false; error: SendValidationError };

/**
 * Validate a send. The address must be a full Sui address; the amount must be above zero and within
 * what can be sent; a WAL send also needs the gas reserve in SUI — else `noGasForWal`.
 */
export function validateSendForm(params: {
  coin: SendCoin;
  amountInput: string;
  addressInput: string;
  suiBalance: bigint;
  walBalance: bigint;
  gasReserve?: bigint;
}): SendValidation {
  const reserve = params.gasReserve ?? SUI_GAS_RESERVE_MIST;
  const address = normalizeSuiAddress(params.addressInput);
  if (!isValidSuiAddress(address)) return { ok: false, error: "invalidAddress" };
  const amount = parseTokenAmountToBaseUnits(params.amountInput);
  if (amount === null || amount <= 0n) return { ok: false, error: "invalidAmount" };
  if (params.coin === "SUI") {
    const max = maxSendableBaseUnits({
      coin: "SUI",
      suiBalance: params.suiBalance,
      walBalance: params.walBalance,
      gasReserve: reserve,
    });
    if (max <= 0n || amount > max) return { ok: false, error: "insufficientBalance" };
  } else {
    if (params.suiBalance < reserve) return { ok: false, error: "noGasForWal" };
    if (amount > params.walBalance) return { ok: false, error: "insufficientBalance" };
  }
  return { ok: true, amountBaseUnits: amount, address };
}

/** The lowest gas budget a person may set: 0.002 SUI. Below it no transaction goes through. */
export const GAS_BUDGET_MIN_MIST = 2_000_000n;
/** The absolute ceiling: 1 SUI. A slipped extra zero stops here. */
export const GAS_BUDGET_ABS_MAX_MIST = 1_000_000_000n;

/**
 * The RECOMMENDED gas budget from a measured (dry-run) fee: twice the measurement, at least
 * 0.005 SUI, at most 1 SUI.
 *
 * Why twice: the measurement is taken against this moment's object versions and reference gas
 * price, and both move a little between signing and broadcast. A budget below the real cost makes
 * the transaction FAIL FOR WANT OF GAS, and that gas is gone; the doubling is what buys out that
 * failure. A budget is a ceiling, not a charge — what is not used stays in the wallet.
 */
export function recommendedGasBudgetMist(estimateMist: bigint): bigint {
  const doubled = estimateMist * 2n;
  const floored = doubled > 5_000_000n ? doubled : 5_000_000n;
  return floored < GAS_BUDGET_ABS_MAX_MIST ? floored : GAS_BUDGET_ABS_MAX_MIST;
}

/** Keep a typed gas budget inside the usable range — clamped, not refused. */
export function clampGasBudgetMist(n: bigint): bigint {
  if (n < GAS_BUDGET_MIN_MIST) return GAS_BUDGET_MIN_MIST;
  return n > GAS_BUDGET_ABS_MAX_MIST ? GAS_BUDGET_ABS_MAX_MIST : n;
}

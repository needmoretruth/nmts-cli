// The wallet an account code derives: its address, and what a chain says it holds.
//
// ⛔ NOTHING HERE SIGNS OR SPENDS, AND NOTHING HERE HANDS OUT A KEY. The only secret this module
//    touches is the 32-byte wallet seed; it lives for the length of one address computation and is
//    wiped on every path out, failures included. No function returns a seed, a private key or a
//    keypair, so a later caller cannot reach one without deciding to add one.
//
// ⛔ THE DERIVATION IS THE ENGINE'S, NOT THIS FILE'S. `wallet_seed_for` is the same WebAssembly
//    function the browser app calls, off the same wallet root, at the same index — so the address
//    printed here is the address the account already has. A second derivation written in
//    TypeScript would be free to drift from the first, and the way that surfaces is somebody
//    funding an address their account cannot spend from.
//
// ⛔ A BALANCE THAT COULD NOT BE READ IS NOT ZERO. On a screen the two look identical; they mean
//    opposite things — "this wallet is empty" and "nobody here knows". Every result below says
//    which of the two it is, and a caller has to open the result to get at a number at all.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { assertUsableCode } from "./account.ts";
import { DERIVED, loadCrypto, type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import type { Network } from "./network.ts";

/**
 * The wallet this account code opens by itself.
 *
 * ⛔ IT IS WALLET 0 BECAUSE THAT IS THE ONE THE BROWSER OPENS. Every wallet, including this one,
 *    comes out of `wallet_seed_for` — there is no special case for the first — so the index is the
 *    whole of the difference between "the account's wallet" and somebody else's.
 */
const BUILT_IN_WALLET_INDEX = 0;

/**
 * How many base units make one coin. SUI counts in MIST and WAL counts in FROST; both are 1e9.
 *
 * The two constants are written as digits and scale rather than as one number so they cannot
 * disagree with each other.
 */
const BASE_UNIT_DIGITS = 9;
const BASE_UNITS_PER_COIN = 10n ** BigInt(BASE_UNIT_DIGITS);

/** The chain's own coin. Its type is fixed by the chain itself and takes no network. */
export const SUI_COIN_TYPE = "0x2::sui::SUI";

/**
 * The storage network's coin, per chain.
 *
 * ⛔ A WRONG VALUE HERE READS AS AN EMPTY WALLET RATHER THAN AS A FAULT. Measured against the
 *    public mainnet node this tool reads from, 2026-08-24: asking for a coin type that does not
 *    exist answers `totalBalance: "0"` — the same answer a real empty balance gives. That
 *    measurement is why `readBalances` never reports a zero WAL balance without first asking the
 *    chain whether it has heard of the type at all; see `ChainReader.knowsCoinType`.
 *
 * ⚠ THIS IS A SECOND COPY. The browser app carries the same two strings for the same reason, and
 *   no machine holds the two level — this package deliberately imports nothing from that tree.
 *   What keeps them honest is the check above: a copy that went stale stops answering zero and
 *   starts saying it could not be read.
 */
export const WAL_COIN_TYPES: Readonly<Record<Network, string>> = {
  testnet: "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL",
  mainnet: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
};

/** The WAL coin type for one network. */
export function walCoinType(network: Network): string {
  return WAL_COIN_TYPES[network];
}

/**
 * The Sui address of one 32-byte wallet seed.
 *
 * ⛔ IT IS THE SDK'S COMPUTATION, NOT ONE WRITTEN HERE. An address is BLAKE2b-256 over a scheme
 *    byte and the public key; hand-rolling that would put a second answer in the world for a
 *    question that must have exactly one, and the failure would be silent — a well-formed address
 *    nobody can spend from.
 *
 * ⚠ THE KEYPAIR HOLDS THE SECRET AND CANNOT BE WIPED. `@mysten/sui` keeps the key inside its own
 *   object, with no method that clears it; the same is true in the browser's worker. What is
 *   controlled here is lifetime: it is built, asked one question, and dropped, and the caller's
 *   copy of the seed is zeroed. Nothing retains it.
 *
 * Exported because the vectors that hold this to the other implementations of the same derivation
 * are (seed, address) pairs, and a test cannot check them through the account-code entry point.
 */
export function addressFromSeed(seed: Uint8Array): string {
  return Ed25519Keypair.fromSecretKey(seed).toSuiAddress();
}

/**
 * The address of the wallet this account code derives. Offline: nothing is asked of anybody.
 *
 * The same address on every network — an account has one wallet, and which chain it is looked up
 * on is a separate question from what it is called.
 */
export async function walletAddress(code: string): Promise<string> {
  // ⛔ The one refusal text for a malformed code lives in `account.ts`. Checking here means a typo
  //    fails the same way it fails everywhere else in this tool rather than as an engine error.
  await assertUsableCode(code);
  const glue = await loadCrypto();
  let bytes: Uint8Array;
  try {
    bytes = glue.account_code_parse(code);
  } catch {
    // ⛔ Unreachable in practice — the same parser accepted this input a line ago. It is caught
    //    anyway because the alternative is an engine message going out verbatim, and an engine
    //    message about a code can carry the code (see `errors.ts`).
    throw new NmtsError("The account code could not be read on this machine.", { exitCode: 1 });
  }
  // ⛔ THIS BUFFER IS EVERY KEY IN THE ACCOUNT, not just the wallet root: the sign-in secret, the
  //    key that opens the files, the key that opens the file list. It is wiped below along with
  //    everything sliced out of it, on the failing paths as well as the good one.
  const derived = glue.kdf_derive(bytes);
  try {
    return addressFromDerived(glue, derived);
  } finally {
    derived.fill(0);
    bytes.fill(0);
  }
}

/**
 * The engine functions this module uses. Narrowed to the one it actually calls.
 *
 * ⛔ NOT A SEAM FOR REPLACING THE ENGINE. Every address this tool prints comes from the real
 *    WebAssembly, and a fake derivation would only prove this file agrees with a fake. The narrow
 *    type exists so a test can WRAP the real function and watch what was handed to it — which is
 *    the only way the wiping below can be checked at all, and the wiping is the part that matters.
 */
export type WalletGlue = Pick<CryptoGlue, "wallet_seed_for">;

/**
 * The built-in wallet's address, from a buffer the caller already holds.
 *
 * ⛔ IT TAKES KEY MATERIAL AND RETURNS A STRING. `derived` belongs to the caller and is left
 *    alone; the two secrets this function makes — the wallet root it slices out and the seed the
 *    engine expands from it — are wiped before it returns, on the failing path as well as the
 *    good one. Neither one leaves.
 */
export function addressFromDerived(glue: WalletGlue, derived: Uint8Array): string {
  const [from, to] = DERIVED.walletRoot;
  const root = derived.slice(from, to);
  let seed: Uint8Array | null = null;
  try {
    seed = glue.wallet_seed_for(root, BUILT_IN_WALLET_INDEX);
    return addressFromSeed(seed);
  } finally {
    root.fill(0);
    seed?.fill(0);
  }
}

/**
 * How much of one coin an address holds, exactly as the chain reported it — or why nobody knows.
 *
 * ⛔ THE TWO CASES ARE DIFFERENT TYPES ON PURPOSE. A number with a "did it work" flag beside it is
 *    a number somebody will read without checking the flag. This shape makes the check unavoidable.
 */
export type CoinBalance =
  | { readonly read: true; readonly baseUnits: bigint }
  | { readonly read: false; readonly why: string };

/** Both balances of one wallet, each answering for itself. */
export interface WalletBalances {
  readonly sui: CoinBalance;
  readonly wal: CoinBalance;
}

/**
 * The chain, as this tool needs it: two questions, no writing.
 *
 * ⛔ A SEAM, NOT AN OPTION. There is no flag that reaches it and no way to supply one from a
 *    command line. It exists so the arithmetic and every failure branch below can be driven by
 *    `node --test` — a test that needed a live chain could not run offline, would answer
 *    differently every day, and could not produce a refusal on demand at all.
 */
export interface ChainReader {
  /** Total held of one coin type, in base units. Throws, with the reason, when it cannot be read. */
  totalOf(coinType: string): Promise<bigint>;
  /**
   * Has this chain heard of the coin type at all?
   *
   * ⛔ THE ONLY QUESTION THAT TELLS AN EMPTY WALLET FROM A COIN TYPE THIS BUILD HAS WRONG. Both
   *    answer "0" to the balance question — see the note on `WAL_COIN_TYPES`.
   */
  knowsCoinType(coinType: string): Promise<boolean>;
}

/** Why a coin came back unread, from whatever was thrown. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read both balances, keeping "could not be read" apart from "empty" in every branch.
 *
 * ⚠ THE REASON A READ FAILED IS SAFE TO PRINT, and that is worth saying because in this tool it
 *   usually is not (`errors.ts`). Nothing secret is in one of these requests: what goes out is a
 *   public address and a coin type, so what comes back cannot quote a secret.
 *
 * ⛔ ONE COIN'S FAILURE DOES NOT TAKE THE OTHER DOWN. They are separate requests about separate
 *   coins, and an answer for one of them is worth more than a matching pair of silences.
 */
export async function readBalances(reader: ChainReader, walType: string): Promise<WalletBalances> {
  const [sui, wal] = await Promise.all([readSui(reader), readWal(reader, walType)]);
  return { sui, wal };
}

async function readSui(reader: ChainReader): Promise<CoinBalance> {
  // ⛔ NO COIN-TYPE CHECK FOR THIS ONE, and the asymmetry is deliberate: `0x2::sui::SUI` is the
  //    chain's own coin, named by the chain rather than by this build, so a zero here is a zero.
  try {
    return { read: true, baseUnits: await reader.totalOf(SUI_COIN_TYPE) };
  } catch (error) {
    return { read: false, why: reasonOf(error) };
  }
}

async function readWal(reader: ChainReader, walType: string): Promise<CoinBalance> {
  let total: bigint;
  try {
    total = await reader.totalOf(walType);
  } catch (error) {
    return { read: false, why: reasonOf(error) };
  }
  // A positive balance is its own proof that the coin type is real; only zero is ambiguous.
  if (total > 0n) return { read: true, baseUnits: total };
  try {
    if (await reader.knowsCoinType(walType)) return { read: true, baseUnits: total };
    return {
      read: false,
      why: "this chain does not know the WAL coin type this version of the tool was built with, so a zero balance here would mean nothing",
    };
  } catch (error) {
    // ⛔ A FAILED CHECK IS NOT A CONFIRMED ZERO. Reporting the zero anyway would be reporting a
    //    number whose one supporting question went unanswered.
    return { read: false, why: `the balance came back as zero and could not be confirmed: ${reasonOf(error)}` };
  }
}

/**
 * Base units as a person reads them — the exact value, never rounded.
 *
 * ⛔ NOT `toFixed`, NOT A SHORTENED FORM. A wallet holding 0.000000004 SUI is not holding "0.00",
 *    and money that reads as zero when it is not is the one rounding error nobody forgives. The
 *    fractional part is trimmed of trailing zeros only, which removes nothing that was there.
 *
 * Callers hand it a total the chain reported; a negative one is refused where it is read, so this
 * never sees one.
 */
export function coinAmount(baseUnits: bigint): string {
  const whole = baseUnits / BASE_UNITS_PER_COIN;
  const fraction = baseUnits % BASE_UNITS_PER_COIN;
  if (fraction === 0n) return whole.toString();
  const digits = fraction.toString().padStart(BASE_UNIT_DIGITS, "0").replace(/0+$/, "");
  return `${whole}.${digits}`;
}

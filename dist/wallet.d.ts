import { type CryptoGlue } from "./crypto.ts";
import type { Network } from "./network.ts";
/**
 * The wallet this NMTS key opens by itself.
 *
 * ⛔ IT IS WALLET 0 BECAUSE THAT IS THE ONE THE BROWSER OPENS. Every wallet, including this one,
 *    comes out of `wallet_seed_for` — there is no special case for the first — so the index is the
 *    whole of the difference between "the account's wallet" and somebody else's.
 *
 * ⛔ EXPORTED SO THE SIGNER CANNOT PICK ITS OWN. `extend-sign.ts` derives a keypair from the same
 *    root and has to reach the SAME wallet as the address printed here; a second literal `0` over
 *    there would be a second answer to a question with one right one, and the failure is silent —
 *    a signature from an address nobody funded. `extend-sign.test.ts` compares the two.
 */
export declare const BUILT_IN_WALLET_INDEX = 0;
/** The chain's own coin. Its type is fixed by the chain itself and takes no network. */
export declare const SUI_COIN_TYPE = "0x2::sui::SUI";
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
export declare const WAL_COIN_TYPES: Readonly<Record<Network, string>>;
/** The WAL coin type for one network. */
export declare function walCoinType(network: Network): string;
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
export declare function addressFromSeed(seed: Uint8Array): string;
/**
 * The address of the wallet this NMTS key derives. Offline: nothing is asked of anybody.
 *
 * The same address on every network — an account has one wallet, and which chain it is looked up
 * on is a separate question from what it is called.
 */
export declare function walletAddress(code: string): Promise<string>;
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
 * The NMTS key wallet's address, from a buffer the caller already holds.
 *
 * ⛔ IT TAKES KEY MATERIAL AND RETURNS A STRING. `derived` belongs to the caller and is left
 *    alone; the two secrets this function makes — the wallet root it slices out and the seed the
 *    engine expands from it — are wiped before it returns, on the failing path as well as the
 *    good one. Neither one leaves.
 */
export declare function addressFromDerived(glue: WalletGlue, derived: Uint8Array): string;
/**
 * How much of one coin an address holds, exactly as the chain reported it — or why nobody knows.
 *
 * ⛔ THE TWO CASES ARE DIFFERENT TYPES ON PURPOSE. A number with a "did it work" flag beside it is
 *    a number somebody will read without checking the flag. This shape makes the check unavoidable.
 */
export type CoinBalance = {
    readonly read: true;
    readonly baseUnits: bigint;
} | {
    readonly read: false;
    readonly why: string;
};
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
export declare function readBalances(reader: ChainReader, walType: string): Promise<WalletBalances>;
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
export declare function coinAmount(baseUnits: bigint): string;

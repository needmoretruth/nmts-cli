import { type CryptoGlue } from "./crypto-surface.ts";
/**
 * Where the engine's WebAssembly sits, in the three places an installation can put it.
 *
 * ⛔ FOUND RATHER THAN CONFIGURED. The package carries it in `vendor/`, a checkout runs from
 *    `src/` with the same folder one level further up, and the repository's own web tree holds a
 *    build of the same crate. A path in a setting would be a fourth answer nobody keeps right.
 */
export declare function engineDir(): string;
/**
 * Load the engine once per process.
 *
 * ⛔ NO TYPE ASSERTION. A dynamically imported module is `unknown`, and staying honest about that
 *    matters here more than anywhere: a rebuild that renamed an export would otherwise become
 *    "undefined is not a function" deep inside a derivation.
 */
export declare function loadEngine(): Promise<CryptoGlue>;
/** For tests that need a fresh load. */
export declare function forgetEngine(): void;

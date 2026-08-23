// Loading the real NMTS crypto engine in Node.
//
// ⛔ NOTHING IS RE-IMPLEMENTED HERE. The bytes that derive an account's keys are the same
//    WebAssembly the browser runs, built from the same Rust crate. Two harnesses in this repo
//    already load it exactly this way and a gate refuses green if their assertion count drops, so
//    this path is held by a machine and not by memory. A TypeScript re-derivation of NCF-3 would
//    be a second implementation that can drift from the first, silently and in the direction that
//    loses files.
//
// ⛔ NO TYPE ASSERTION. A dynamically imported module is `unknown` and staying honest about that
//    matters here more than anywhere: if a rebuild renamed an export, an `as` would turn that into
//    "undefined is not a function" deep inside a derivation. The guard below checks each function
//    exists before anything is derived, so a missing export is named at load time.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NmtsError } from "./errors.ts";

/** The slice of the engine this tool uses. Every name here is checked at load time. */
export interface CryptoGlue {
  /** Text form to the 20 raw bytes. Throws when the check symbol does not match. */
  account_code_parse(input: string): Uint8Array;
  /** The grouped, human-readable spelling of a code. */
  account_code_display(codeBytes: Uint8Array): string;
  /** The full derivation output. Offsets are named in DERIVED below. */
  kdf_derive(codeBytes: Uint8Array): Uint8Array;
  /** Display form of a share address, which is what a person shares. */
  share_address_display(address: Uint8Array): string;
}

const REQUIRED: readonly (keyof CryptoGlue)[] = [
  "account_code_parse",
  "account_code_display",
  "kdf_derive",
  "share_address_display",
];

/**
 * Byte ranges inside `kdf_derive`'s output.
 *
 * ⛔ These are a CONTRACT WITH A FROZEN FORMAT (NCF-3 §1), not a convenience. They are written
 *    here as ranges rather than magic numbers at call sites so a reader can check them against the
 *    format document in one place — and so a future version bump changes one table.
 */
export const DERIVED = {
  accountId: [0, 16],
  authSecret: [16, 48],
  dataKey: [48, 80],
  shareAddress: [208, 224],
} as const;

function isCryptoGlue(value: unknown): value is CryptoGlue {
  return missingExports(value).length === 0;
}

/** Which of the required functions this object does not have. Empty means it is the engine. */
function missingExports(value: unknown): (keyof CryptoGlue)[] {
  if (typeof value !== "object" || value === null) return [...REQUIRED];
  return REQUIRED.filter((name) => {
    if (!(name in value)) return true;
    const member: unknown = Reflect.get(value, name);
    return typeof member !== "function";
  });
}

/**
 * Where the engine is.
 *
 * Two layouts are real: inside the published package the vendored engine sits beside the code, and
 * inside this repository it lives in web/vendor where the browser build also reads it. Looking in
 * both is what lets the same source run from a checkout and from an install.
 */
export function engineDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "vendor", "nmts-crypto"),
    join(here, "..", "..", "vendor", "nmts-crypto"),
    join(here, "..", "..", "web", "vendor", "nmts-crypto"),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "nmts_crypto_wasm_bg.wasm"))) return dir;
  }
  throw new NmtsError("The NMTS crypto engine is missing from this installation.", {
    exitCode: 1,
    nextStep: "Reinstall the package. Nothing can be encrypted or decrypted without it.",
  });
}

let cached: CryptoGlue | null = null;

/** Load the engine once per process. */
export async function loadCrypto(): Promise<CryptoGlue> {
  if (cached !== null) return cached;
  const dir = engineDir();
  const module: unknown = await import(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href);
  if (typeof module !== "object" || module === null || !("default" in module)) {
    throw new NmtsError("The NMTS crypto engine did not load (no initialiser).", { exitCode: 1 });
  }
  const init: unknown = Reflect.get(module, "default");
  if (typeof init !== "function") {
    throw new NmtsError("The NMTS crypto engine did not load (initialiser is not callable).", {
      exitCode: 1,
    });
  }
  await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
  if (!isCryptoGlue(module)) {
    const missing = missingExports(module);
    throw new NmtsError(
      `The NMTS crypto engine is missing: ${missing.join(", ")}. This build does not match this tool.`,
      { exitCode: 1, nextStep: "Reinstall the package." },
    );
  }
  cached = module;
  return module;
}

/** For tests that need a fresh load. */
export function forgetCrypto(): void {
  cached = null;
}

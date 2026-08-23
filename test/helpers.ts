// Shared test helpers.
//
// ⛔ CODES ARE GENERATED, NEVER HARD-CODED. A fixed account code in a test file reads like a
//    credential to every scanner and every person who finds it, and one day somebody creates the
//    account it names. The engine makes a fresh one in under a millisecond.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { engineDir } from "../src/crypto.ts";

let generate: ((...args: never[]) => unknown) | null = null;

/** A throwaway account code from the engine. Not an account: nothing was ever created for it. */
export async function generateCode(): Promise<string> {
  if (generate === null) {
    const dir = engineDir();
    const glue: unknown = await import(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href);
    if (typeof glue !== "object" || glue === null) throw new Error("engine did not load");
    const init: unknown = Reflect.get(glue, "default");
    if (typeof init !== "function") throw new Error("engine has no initialiser");
    await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
    const fn: unknown = Reflect.get(glue, "account_code_generate");
    if (typeof fn !== "function") throw new Error("engine cannot generate a code");
    generate = fn;
  }
  const code: unknown = generate();
  if (typeof code !== "string") throw new Error("engine returned a non-string code");
  return code;
}

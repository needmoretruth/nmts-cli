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

/** The engine, loaded once. Tests that seal need functions the tool itself never calls. */
let engine: Record<string, unknown> | null = null;

async function loadEngine(): Promise<Record<string, unknown>> {
  if (engine !== null) return engine;
  const dir = engineDir();
  const glue: unknown = await import(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href);
  if (typeof glue !== "object" || glue === null) throw new Error("engine did not load");
  const init: unknown = Reflect.get(glue, "default");
  if (typeof init !== "function") throw new Error("engine has no initialiser");
  await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
  engine = glue as Record<string, unknown>;
  return engine;
}

function fn(host: Record<string, unknown>, name: string): (...args: never[]) => unknown {
  const member = host[name];
  if (typeof member !== "function") throw new Error(`engine has no ${name}`);
  return member as (...args: never[]) => unknown;
}

/**
 * Seal a file list the way the browser does, so a test can serve one a real `ls` will open.
 *
 * ⛔ It seals with the SAME key the tool derives (`fileListKey`, bytes [80,112)) and the SAME
 *    associated data. A test that used different ones would prove the tool agrees with the test
 *    rather than with the format.
 */
export async function sealFileList(code: string, body: Uint8Array): Promise<string> {
  const glue = await loadEngine();
  const parse = fn(glue, "account_code_parse") as (input: string) => Uint8Array;
  const derive = fn(glue, "kdf_derive") as (bytes: Uint8Array) => Uint8Array;
  const seal = fn(glue, "envelope_seal") as (k: Uint8Array, aad: Uint8Array, pt: Uint8Array) => Uint8Array;
  const b64 = fn(glue, "b64_encode") as (bytes: Uint8Array) => string;
  const derived = derive(parse(code));
  const key = derived.slice(80, 112);
  derived.fill(0);
  const out = b64(seal(key, new TextEncoder().encode("nmts/v3/file-list"), body));
  key.fill(0);
  return out;
}

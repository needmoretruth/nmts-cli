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

/** One part of a sealed file, as the storage network would hold it. */
export interface SealedPart {
  blobId: string;
  sealed: Uint8Array;
}

/** What sealing a file produces: what the file list would carry, and what the network would hold. */
export interface SealedFile {
  dekWrapped: string;
  contentHashCt: string;
  parts: SealedPart[];
}

/**
 * Seal a file the way the browser does, so a test can serve one a real `get` will open.
 *
 * ⛔ Same keys, same associated data, same order as the product: the file key is wrapped under the
 *    account's data key, the whole-file hash is sealed under the same key, and each part is its own
 *    NCF-3 stream under the file key. A test that used different ones would prove the tool agrees
 *    with the test rather than with the format.
 *
 * `pieces` are the parts IN ORDER. Pad the last one by handing it more bytes than the file holds —
 * that is exactly what the write side does, and the caller passes the real `size` separately.
 */
export async function sealFile(
  code: string,
  pieces: readonly Uint8Array[],
  size?: number,
): Promise<SealedFile> {
  const glue = await loadEngine();
  const parse = fn(glue, "account_code_parse") as (input: string) => Uint8Array;
  const derive = fn(glue, "kdf_derive") as (bytes: Uint8Array) => Uint8Array;
  const seal = fn(glue, "envelope_seal") as (k: Uint8Array, aad: Uint8Array, pt: Uint8Array) => Uint8Array;
  const b64 = fn(glue, "b64_encode") as (bytes: Uint8Array) => string;
  const genDek = fn(glue, "generate_dek") as () => Uint8Array;
  const encrypt = fn(glue, "stream_encrypt_all") as (dek: Uint8Array, pt: Uint8Array) => Uint8Array;

  const derived = derive(parse(code));
  const dataKey = derived.slice(48, 80);
  derived.fill(0);
  const dek = genDek();

  const utf8 = new TextEncoder();
  const dekWrapped = b64(seal(dataKey, utf8.encode("nmts/v3/dek-wrap"), dek));

  // ⛔ The hash covers the FILE, not the stored bytes. A padded last part carries more plaintext
  //    than the file holds, and hashing that would make the product's own check fail on a file it
  //    sealed correctly — the browser hashes what it writes out, which is `size` bytes.
  const total = pieces.reduce((n, piece) => n + piece.length, 0);
  const real = size ?? total;
  const { createHash } = await import("node:crypto");
  const hasher = createHash("sha256");
  let left = real;
  for (const piece of pieces) {
    if (left <= 0) break;
    hasher.update(piece.subarray(0, Math.min(left, piece.length)));
    left -= piece.length;
  }
  const contentHashCt = b64(seal(dataKey, utf8.encode("nmts/v3/content-hash"), new Uint8Array(hasher.digest())));
  dataKey.fill(0);

  const parts = pieces.map((piece, i) => ({
    blobId: `test-blob-${i}-${piece.length}`,
    sealed: encrypt(dek, piece),
  }));
  dek.fill(0);
  return { dekWrapped, contentHashCt, parts };
}

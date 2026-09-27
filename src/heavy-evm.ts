// The EVM wallets an NMTS key derives (NCF-3 §1.9) — the key the engine hands out, and the address
// computed from it here.
//
// ⛔ THE KEY COMES FROM THE ENGINE, NEVER FROM HERE. `evm_key_for` is the same WebAssembly the
//    browser and the recovery tool run, so one NMTS key names one Filecoin address everywhere.
//    Only the step from a private key to its address is written in TypeScript, because it is the
//    textbook one (secp256k1 public key → Keccak-256 → last 20 bytes, EIP-55 case) and a test holds
//    it to the frozen vectors in `crypto/tests/vectors/ncf3-evm.json`.
//
// ⛔ EVERY KEY IS WIPED BY WHOEVER ASKED FOR IT. The derivation output holds every key in the
//    account; it and the wallet root sliced out of it are zeroed here on every path out.
//
// ⚠ NO `t410`/`f410` FORM. Neither viem nor the Synapse packages carry a helper for Filecoin's
//   delegated address spelling, and it is not written by hand here — the 0x address is the one the
//   Filecoin EVM, the Synapse SDK and every EVM wallet read.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { PrivateKeyAccount } from "viem/accounts";

import { assertUsableCode } from "./account.ts";
import { DERIVED, loadCrypto } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { BINARY_NAME } from "./product.ts";

/** The highest EVM wallet number accepted — the same range the Sui wallets use. */
const EVM_INDEX_LIMIT = 2 ** 31;

/** An EVM wallet number as a person typed it. Refused, never rounded. */
export function evmIndexOf(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const text = raw.trim();
  const value = Number(text);
  if (!/^[0-9]+$/u.test(text) || !Number.isSafeInteger(value) || value >= EVM_INDEX_LIMIT) {
    throw new NmtsError(`An EVM wallet number is a whole number from 0 to ${EVM_INDEX_LIMIT - 1}, not "${raw}".`, {
      exitCode: 2,
      nextStep: `Nothing was signed. \`${BINARY_NAME} heavy wallet\` shows wallet 0.`,
    });
  }
  return value;
}

/** `0x` + 40 hex, in EIP-55 mixed case. */
function checksummed(addressHex: string): `0x${string}` {
  const lower = addressHex.toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out: `0x${string}` = "0x";
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower.charAt(i);
    const byte = hash[i >> 1] ?? 0;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    out = `${out}${nibble >= 8 ? char.toUpperCase() : char}`;
  }
  return out;
}

/** The EIP-55 address of a 32-byte secp256k1 private key. */
export function evmAddressOf(privateKey: Uint8Array): `0x${string}` {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const digest = keccak_256(publicKey.subarray(1));
  const hex = Array.from(digest.subarray(12), (b) => b.toString(16).padStart(2, "0")).join("");
  return checksummed(hex);
}

/**
 * EVM wallet `index`'s private key, from an NMTS key.
 *
 * ⛔ THE CALLER WIPES WHAT COMES BACK — it moves money on Filecoin.
 */
export async function evmKeyOf(code: string, index: number): Promise<Uint8Array> {
  await assertUsableCode(code);
  const glue = await loadCrypto();
  const bytes = glue.account_code_parse(code);
  const derived = glue.kdf_derive(bytes);
  const [from, to] = DERIVED.walletRoot;
  const root = derived.slice(from, to);
  try {
    return glue.evm_key_for(root, index);
  } finally {
    root.fill(0);
    derived.fill(0);
    bytes.fill(0);
  }
}

/** EVM wallet `index`'s address, from an NMTS key. Nothing is signed; the key is wiped here. */
export async function evmAddressFor(code: string, index: number): Promise<`0x${string}`> {
  const key = await evmKeyOf(code, index);
  try {
    return evmAddressOf(key);
  } finally {
    key.fill(0);
  }
}

/**
 * EVM wallet `index` as a viem account that signs. The key bytes are wiped once the account holds
 * them; the account itself keeps the key for as long as the caller keeps the account.
 */
export async function evmAccountFor(code: string, index: number): Promise<PrivateKeyAccount> {
  const key = await evmKeyOf(code, index);
  try {
    const { privateKeyToAccount } = await import("viem/accounts");
    return privateKeyToAccount(hexKey(key));
  } finally {
    key.fill(0);
  }
}

/** `0x…` for viem, from key bytes. ⚠ The string cannot be wiped; keep it only as long as the call. */
export function hexKey(key: Uint8Array): `0x${string}` {
  return `0x${Array.from(key, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// The EVM wallets an NMTS key derives, held to the frozen NCF-3 §1.9 vectors.
//
// ⛔ THE VECTORS WERE NOT WRITTEN BY THIS PACKAGE. `ncf3-evm.json` was produced by an independent
//    generator and checked against viem; the Rust crate and the browser engine are held to the same
//    file. So the engine's key and this package's address step both have to agree with it.
// ⚠ The file lives in the NMTS repository (`crypto/tests/vectors/`); where that folder is absent the
//   vector test skips, and the generator key below still holds the address step.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadCrypto } from "../src/crypto.ts";
import { evmAddressOf, evmIndexOf } from "../src/heavy-evm.ts";

interface Vectors {
  accounts: { label: string; wallet_root_hex: string; wallets: { index: number; key_hex: string; address: string }[] }[];
  generator_key_one: { key_hex: string; address: string };
}

const here = dirname(fileURLToPath(import.meta.url));
const skip = existsSync(join(here, "..", "..", "crypto")) ? false : "the frozen vectors live in the NMTS repository";
const vectors = (): Vectors =>
  JSON.parse(readFileSync(join(here, "..", "..", "crypto", "tests", "vectors", "ncf3-evm.json"), "utf8"));

function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

test("every frozen key gives its frozen EIP-55 address, and the engine derives every frozen key", { skip }, async () => {
  const glue = await loadCrypto();
  let checked = 0;
  const frozen = vectors();
  for (const account of frozen.accounts) {
    for (const wallet of account.wallets) {
      const key = glue.evm_key_for(bytesOf(account.wallet_root_hex), wallet.index);
      assert.equal(Buffer.from(key).toString("hex"), wallet.key_hex, `${account.label} #${wallet.index} key`);
      assert.equal(evmAddressOf(key), wallet.address, `${account.label} #${wallet.index} address`);
      checked += 1;
    }
  }
  assert.ok(checked >= 9, `only ${checked} vectors were read`);
  assert.equal(evmAddressOf(bytesOf(frozen.generator_key_one.key_hex)), frozen.generator_key_one.address);
});

test("private key 1 is the generator point's address, 0x7E5F…5Bdf", () => {
  const one = new Uint8Array(32);
  one[31] = 1;
  assert.equal(evmAddressOf(one), "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
});

test("an EVM wallet number is a whole number, and nothing else is rounded to one", () => {
  assert.equal(evmIndexOf(undefined), 0);
  assert.equal(evmIndexOf("7"), 7);
  for (const bad of ["-1", "1.5", "x", "2147483648"]) assert.throws(() => evmIndexOf(bad), /EVM wallet number/);
});

// `put --pay wallet --sui-key-file <file>`: a wallet this NMTS key does not derive pays (L338 · D27).
//
// ⛔ WHAT MUST HOLD. The address priced is the key file's address (the review names it and every
//    balance is read for it), the signature is that key's over the bytes it was handed, a key file
//    other users can read is refused before anything is read, and two payers in one run are refused.
import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { verifyTransactionSignature } from "@mysten/sui/verify";

import { put } from "../src/commands/put.ts";
import { modesAreEnforced } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { payerFromKeyFile } from "../src/payer-key-file.ts";
import { collect, startFakeDrive } from "./fake-drive.ts";
import { withWalletAgreed } from "./fake-extend.ts";
import { FILE, fakeReads, putWalletOpts, refuseToSign } from "./fake-put-wallet.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const dir = mkdtempSync(join(tmpdir(), "nmts-payer-key-"));
const keypair = new Ed25519Keypair();
const KEY = join(dir, "payer.key");
writeFileSync(KEY, `${keypair.getSecretKey()}\n`, { mode: 0o600 });

test("the key file's wallet is the one priced: the review names it and its balances are read", async () => {
  await withWalletAgreed(drive, "put-key-file-dry", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    const reads = fakeReads();
    const asked: string[] = [];
    const readChain = () => ({ ...reads, readWallet: async (address: string) => (asked.push(address), reads.readWallet(address)) });
    const sign = refuseToSign("--dry-run reached a signer");
    assert.equal(await put(FILE, putWalletOpts(drive, out, { dryRun: true, suiKeyFile: KEY, readChain, sign })), 0);
    assert.deepEqual(asked, [keypair.toSuiAddress()]);
    assert.match(out.lines.join("\n"), new RegExp(`Wallet ${keypair.toSuiAddress()} holds`));
    assert.equal(sign.calls, 0);
  });
});

test("it signs with that key, over exactly the bytes it was handed", async () => {
  const payer = payerFromKeyFile(KEY);
  assert.equal(payer.address, keypair.toSuiAddress());
  // Any bytes do for the signature check; the chain judges what they mean.
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const signed = await payer.signTransaction({ bytes, chain: "sui:testnet" });
  assert.deepEqual(signed.bytes, bytes);
  const key = await verifyTransactionSignature(bytes, signed.signature);
  assert.equal(key.toSuiAddress(), keypair.toSuiAddress());
});

test("⛔ a key file other users can read is refused, and its contents are not quoted", { skip: !modesAreEnforced() }, () => {
  const open = join(dir, "open.key");
  writeFileSync(open, `${keypair.getSecretKey()}\n`);
  chmodSync(open, 0o644);
  assert.throws(() => payerFromKeyFile(open), (error: unknown) => {
    assert.ok(error instanceof NmtsError);
    assert.match(error.message, /can be read by other users/);
    assert.match(error.nextStep ?? "", /chmod 600/);
    assert.ok(!error.message.includes("suiprivkey"));
    return true;
  });
});

test("⛔ two payers in one run, and a key file without --pay wallet, are refused before anything is sent", async () => {
  for (const [extra, why] of [
    [{ pay: "wallet", wallet: "2", suiKeyFile: KEY }, /--wallet names one of this key's wallets/],
    [{ pay: undefined, suiKeyFile: KEY }, /--sui-key-file only applies with --pay wallet/],
  ] as const) {
    const failure = await put(FILE, { server: drive.base, network: "testnet", write: () => undefined, ...extra }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError, "it did not refuse");
    assert.equal(failure.exitCode, 2);
    assert.match(failure.message, why);
  }
});

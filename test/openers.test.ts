// Wallet sign-in: attaching a wallet, opening an account with it, and every way a signature is
// refused.
//
// ⛔ THE SIGNATURES ARE REAL ONES FROM THE CHAIN LIBRARY'S OWN KEYPAIRS, all three schemes an
//    opener may use. A fake signer would prove that this code agrees with itself; what has to hold
//    is that the bytes a wallet actually produces open a slot the engine actually sealed.
//
// ⛔ AND THE SERVER IS THE FAKE ONE WITH THE REAL REFUSALS: the three account doors turn away a
//    credential that arrives without the account code's proof, exactly as the live ones do, so a
//    call that forgot it fails here.

import { strict as assert } from "node:assert";
import { after, before, test } from "node:test";

import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { decodeSuiPrivateKey, messageWithIntent, toSerializedSignature, type Signer } from "@mysten/sui/cryptography";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";

import { NmtsError } from "../src/errors.ts";
import {
  addWallet,
  listOpeners,
  openerMessage,
  removeWallet,
  signInWithWallet,
  walletSlot,
  type OpenerAccess,
  type SignWallet,
  type WalletOpener,
} from "../src/openers.ts";
import { registrationProofOf } from "../src/registration.ts";
import { generateCode } from "./helpers.ts";
import { startFakeDrive, withSandbox, KEY, type FakeDrive } from "./fake-drive.ts";
import { openerState } from "./fake-openers.ts";

let drive: FakeDrive;
before(async () => {
  drive = await startFakeDrive();
});
after(() => drive.close());

/** What the three account doors need: where to talk, the credential, and the code's own proof. */
async function reach(code: string): Promise<OpenerAccess> {
  const { authSecret } = await registrationProofOf(code);
  return { server: drive.base, apiKey: KEY, accountProof: authSecret };
}

/** A wallet a test drives, remembering every signature it handed out. */
function wallet(keypair: Signer): { opener: WalletOpener; given: string[] } {
  const given: string[] = [];
  const sign: SignWallet = async (message: Uint8Array) => {
    const answer = await keypair.signPersonalMessage(message);
    given.push(answer.signature);
    return answer;
  };
  return { opener: { address: keypair.toSuiAddress(), sign }, given };
}

/**
 * One HEDGED signature from a wallet that signs deterministically by default: the same key, the
 * same message, fresh entropy in the nonce — valid, and different every time.
 *
 * ⚠ IT IS THE CHAIN LIBRARY'S OWN PIPELINE with one flag changed, and the test below the equality
 *   rule proves that: built without the flag it reproduces `signPersonalMessage` byte for byte.
 */
function hedged(keypair: Secp256k1Keypair, message: Uint8Array, entropy = true): string {
  const { secretKey } = decodeSuiPrivateKey(keypair.getSecretKey());
  const intent = messageWithIntent("PersonalMessage", bcs.vector(bcs.u8()).serialize(message).toBytes());
  const signature = secp256k1.sign(blake2b(intent, { dkLen: 32 }), secretKey, { lowS: true, extraEntropy: entropy });
  secretKey.fill(0);
  return toSerializedSignature({ signatureScheme: "Secp256k1", signature, publicKey: keypair.getPublicKey() });
}

/**
 * Whether `needle` can be reached from `value` by walking own properties, arrays, maps and sets.
 *
 * ⚠ WHAT IT CANNOT SEE: a `#private` field or a closure variable, neither of which any reflection
 *   reaches. It is the proof for the plain objects these functions answer with, which is what a
 *   caller holds afterwards.
 */
function reaches(value: unknown, needle: string): boolean {
  const seen = new Set<object>();
  const walk = (node: unknown): boolean => {
    if (typeof node === "string") return node.includes(needle);
    if (node instanceof Uint8Array) return Buffer.from(node).toString("base64").includes(needle);
    if (node === null || typeof node !== "object") return false;
    if (seen.has(node)) return false;
    seen.add(node);
    if (node instanceof Map) return [...node.keys()].some(walk) || [...node.values()].some(walk);
    if (node instanceof Set) return [...node].some(walk);
    return Object.keys(node).map((key) => Reflect.get(node, key)).some(walk);
  };
  return walk(value);
}

for (const [name, make] of [
  ["Ed25519", () => new Ed25519Keypair()],
  ["secp256k1", () => new Secp256k1Keypair()],
  ["secp256r1", () => new Secp256r1Keypair()],
] as const) {
  test(`[${name}] a wallet that was attached opens the account again`, async () => {
    await withSandbox(drive, `cli-openers-${name}`, async (code) => {
      const access = await reach(code);
      const { opener } = wallet(make());
      const attached = await addWallet(access, code, opener);

      // ⛔ THE SERVER ASKS FOR THE CODE'S OWN PROOF ON THIS DOOR AND REFUSES WITHOUT IT.
      assert.ok(openerState.calls.at(-1)?.proof, "the attach travelled without the account proof");
      assert.equal(openerState.slots.get(attached.locator)?.slot.length, 62, "the slot is not 62 bytes");

      // ⛔ AND THE SIGN-IN CARRIES NO CREDENTIAL AT ALL: the slot is what says which account it is.
      const opened = await signInWithWallet(drive.base, opener);
      assert.equal(opened.accountCode, code, "the wallet opened a different NMTS key");
      assert.equal(opened.locator, attached.locator);
    });
  });
}

test("a wallet that already opens this account is told so, and nothing is sent", async () => {
  await withSandbox(drive, "cli-openers-again", async (code) => {
    const access = await reach(code);
    const { opener } = wallet(new Ed25519Keypair());
    await addWallet(access, code, opener);

    await assert.rejects(addWallet(access, code, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /^WALLET_ALREADY_ATTACHED: /);
      assert.equal(error.exitCode, 4);
      return true;
    });
    assert.equal(openerState.slots.size, 1, "a refused attach stored a second slot");
    // ⛔ IT IS ANSWERED BEFORE THE DOOR IS KNOCKED ON: one PUT for the attach that worked, and the
    //    refused one never became the server's flat "not found".
    assert.equal(openerState.calls.filter((one) => one.method === "PUT").length, 1);
  });
});

test("a wallet that opens ANOTHER account is refused, and another number attaches it", async () => {
  await withSandbox(drive, "cli-openers-taken", async (code) => {
    const { opener } = wallet(new Ed25519Keypair());
    const first = await addWallet(await reach(code), code, opener);

    // A second NMTS key — the account this wallet is now being pointed at.
    const other = await generateCode();
    const otherAccess = await reach(other);
    await assert.rejects(addWallet(otherAccess, other, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /^WALLET_OPENS_ANOTHER_ACCOUNT: under account number 1, /);
      assert.equal(error.exitCode, 4);
      return true;
    });
    assert.equal(openerState.slots.size, 1, "a refused attach stored a slot");

    // ⛔ AND THE WAY OUT WORKS: the number is inside the signed bytes, so number 2 is a different
    //    name and a free one.
    const second = await addWallet(otherAccess, other, { ...opener, account: 2 });
    assert.notEqual(second.locator, first.locator);
    assert.equal(openerState.slots.size, 2);
  });
});

test("the same wallet, signing differently the second time, is refused and stores nothing", async () => {
  await withSandbox(drive, "cli-openers-hedged", async (code) => {
    const access = await reach(code);
    const first = new Ed25519Keypair();
    const second = new Ed25519Keypair();
    // ⚠ BOTH SIGNATURES ARE VALID FOR THEIR OWN KEY, and the second is a different wallet's — which
    //   is what a hedging signer looks like from here: two good answers to one question.
    let asked = 0;
    const opener: WalletOpener = {
      address: first.toSuiAddress(),
      sign: async (message: Uint8Array) => {
        asked += 1;
        return asked === 1 ? first.signPersonalMessage(message) : second.signPersonalMessage(message);
      },
    };
    await assert.rejects(addWallet(access, code, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      // The second answer is a different wallet, so it fails the address check first; a signer that
      // hedged with the SAME key reaches the equality rule. Both refuse before anything is stored.
      assert.match(error.message, /WALLET_SIGNATURE_INVALID|WALLET_NOT_REPEATABLE/);
      return true;
    });
    assert.equal(openerState.slots.size, 0, "a refused attach stored a slot");
  });
});

test("⛔ a HEDGING wallet — two valid signatures over one message — is refused by name", async () => {
  await withSandbox(drive, "cli-openers-hedging", async (code) => {
    const access = await reach(code);
    const keypair = new Secp256k1Keypair();
    // ⛔ THE FAILURE THIS EXISTS FOR, AND IT IS NOT HYPOTHETICAL. Both answers below are this
    //    wallet's own, both verify against its address, and they are different bytes — which is
    //    what ECDSA with added entropy produces, what several signing services do, and what the
    //    CFRG now calls the default for every environment. A slot sealed under the first could
    //    never be opened by the second, so the account would be unreachable at the next sign-in.
    const opener: WalletOpener = { address: keypair.toSuiAddress(), sign: (m) => hedged(keypair, m) };
    await assert.rejects(addWallet(access, code, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /WALLET_NOT_REPEATABLE/);
      return true;
    });
    assert.equal(openerState.slots.size, 0, "a refused attach stored a slot");
  });
});

test("the hedged signer is the chain library's own signature with one flag changed", async () => {
  // ⛔ WITHOUT THIS, THE TEST ABOVE COULD BE PASSING ON A SIGNATURE NO WALLET WOULD EVER MAKE. Built
  //    with the entropy off, this pipeline has to reproduce `signPersonalMessage` exactly.
  const keypair = new Secp256k1Keypair();
  const message = new TextEncoder().encode("NMTS wallet sign-in");
  assert.equal(hedged(keypair, message, false), (await keypair.signPersonalMessage(message)).signature);
});

test("a signature over other bytes is refused, and named as that", async () => {
  await withSandbox(drive, "cli-openers-other-bytes", async (code) => {
    const access = await reach(code);
    const keypair = new Ed25519Keypair();
    const opener: WalletOpener = {
      address: keypair.toSuiAddress(),
      // A wallet that signed its own text and said so: the `bytes` it answers are not the message.
      sign: async () => keypair.signPersonalMessage(new TextEncoder().encode("approve this transfer")),
    };
    await assert.rejects(addWallet(access, code, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /WALLET_SIGNED_OTHER_BYTES/);
      return true;
    });
    // And the same wallet WITHOUT the `bytes` field is refused too — by the signature, not by them.
    const quiet: WalletOpener = {
      address: keypair.toSuiAddress(),
      sign: async () => (await keypair.signPersonalMessage(new TextEncoder().encode("x"))).signature,
    };
    await assert.rejects(addWallet(access, code, quiet), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /WALLET_SIGNATURE_INVALID/);
      return true;
    });
    assert.equal(openerState.slots.size, 0, "a refused attach stored a slot");
  });
});

test("every kind of wallet that cannot hold an opener is refused with its own reason", async () => {
  await withSandbox(drive, "cli-openers-kinds", async (code) => {
    const access = await reach(code);
    const address = new Ed25519Keypair().toSuiAddress();
    for (const [flag, code_] of [
      [0x03, "WALLET_MULTISIG"],
      [0x05, "WALLET_ZKLOGIN"],
      [0x06, "WALLET_PASSKEY"],
      [0x7f, "WALLET_UNKNOWN_SCHEME"],
    ] as const) {
      const serialized = new Uint8Array(97);
      serialized[0] = flag;
      const opener: WalletOpener = {
        address,
        sign: () => Buffer.from(serialized).toString("base64"),
      };
      await assert.rejects(addWallet(access, code, opener), (error: unknown) => {
        assert.ok(error instanceof NmtsError, `flag ${flag} was refused as something else`);
        assert.match(error.message, new RegExp(code_));
        return true;
      });
    }
    assert.equal(openerState.slots.size, 0, "a refused attach stored a slot");
  });
});

test("a wallet with no opener on this server is told that, rather than being let in", async () => {
  await withSandbox(drive, "cli-openers-none", async () => {
    const { opener } = wallet(new Ed25519Keypair());
    await assert.rejects(signInWithWallet(drive.base, opener), (error: unknown) => {
      assert.ok(error instanceof NmtsError);
      assert.match(error.message, /NO_OPENER_FOR_WALLET/);
      return true;
    });
  });
});

test("the account number is inside the signed bytes, so two numbers are two openers", async () => {
  await withSandbox(drive, "cli-openers-numbers", async (code) => {
    const access = await reach(code);
    const keypair = new Ed25519Keypair();
    const one = await openerMessage({ address: keypair.toSuiAddress(), sign: () => "", account: 1 });
    const two = await openerMessage({ address: keypair.toSuiAddress(), sign: () => "", account: 2 });
    assert.notDeepEqual(one, two, "two account numbers built the same message");
    const { opener } = wallet(keypair);
    const first = await addWallet(access, code, { ...opener, account: 1 });
    const second = await addWallet(access, code, { ...opener, account: 2 });
    assert.notEqual(first.locator, second.locator, "two numbers landed on one locator");
    assert.equal(openerState.slots.size, 2);
  });
});

test("listing, exporting and removing go through the account's own proof", async () => {
  await withSandbox(drive, "cli-openers-list", async (code) => {
    const access = await reach(code);
    const { opener } = wallet(new Ed25519Keypair());
    const attached = await addWallet(access, code, opener);

    const listed = await listOpeners(access);
    assert.deepEqual(listed.openers.map((o) => [o.locator, o.kind]), [[attached.locator, "wallet"]]);
    assert.equal(listed.cap, 8);
    assert.ok(openerState.calls.at(-1)?.proof, "the listing travelled without the account proof");

    // The recovery tool's file: the sealed bytes themselves, fetched by name and with no credential.
    assert.equal((await walletSlot(drive.base, attached.locator)).length, 62);

    await removeWallet(access, attached.locator);
    assert.ok(openerState.calls.at(-1)?.proof, "the removal travelled without the account proof");
    assert.equal(openerState.slots.size, 0);
    // ⛔ AND THE WALLET NO LONGER OPENS THE ACCOUNT, which is the only thing removal promises.
    await assert.rejects(signInWithWallet(drive.base, opener), /NO_OPENER_FOR_WALLET/);
  });
});

test("⛔ nothing these functions answer with can reach the signature", async () => {
  await withSandbox(drive, "cli-openers-no-signature", async (code) => {
    const access = await reach(code);
    const { opener, given } = wallet(new Ed25519Keypair());
    const attached = await addWallet(access, code, opener);
    const opened = await signInWithWallet(drive.base, opener);
    const listed = await listOpeners(access);
    assert.ok(given.length >= 3, "the wallet was never asked to sign");
    for (const signature of given) {
      // ⚠ Both spellings: the base64 the wallet answered, and the raw bytes it decodes to — a field
      //   holding either would be the account for as long as the slot exists.
      const raw = Buffer.from(signature, "base64").toString("base64");
      for (const [what, value] of [["attach", attached], ["sign-in", opened], ["list", listed]] as const) {
        assert.ok(!reaches(value, signature), `the ${what} answer holds the wallet's signature`);
        assert.ok(!reaches(value, raw.slice(0, 40)), `the ${what} answer holds the signature's bytes`);
      }
    }
  });
});

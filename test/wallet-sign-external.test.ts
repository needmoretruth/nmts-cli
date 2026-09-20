// Signing with a wallet this tool holds no key to: what is asked of it, what is submitted, and what
// is called a failure.
//
// ⛔ WHAT CAN BE PROVED HERE, AND WHAT CANNOT. No chain is reached and no wallet exists: the client
//    and the wallet are both handed in, which is what lets this hold the three things that fail
//    silently — that the wallet is asked to sign the bytes this tool built, that the signature IT
//    answered with is what goes to the chain, and that a transaction which executed and FAILED is
//    reported as a failure rather than as a digest. Whether a real wallet signs what a real node
//    accepts cannot be known without spending SUI.
//
// ⚠ The transactions themselves are built by `upload-wallet-chain.ts` and `storage-control-chain.ts`
//   — the same builders the key's own signers use — so what is held here is the half that is new:
//   who is asked, and what is done with the answer.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { toBase64 } from "@mysten/sui/utils";
import { TransactionDataBuilder } from "@mysten/sui/transactions";

import { NmtsError } from "../src/errors.ts";
import {
  signAndSubmit,
  type ExternalPayer,
  type SubmitClient,
  type SubmittedTransaction,
} from "../src/wallet-sign-external.ts";

/** Bytes that stand for a built transaction. Nothing here parses them; the digest is their hash. */
const BYTES = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

const REFUSALS = {
  unsigned: "Nothing was signed and nothing was spent.",
  refused: { what: "The chain refused it", nextStep: "The transaction fee was spent." },
};

/** A wallet that signs whatever it is handed, and remembers being asked. */
function payerThat(over: { signature?: string; bytes?: Uint8Array | string; fail?: string } = {}): ExternalPayer & {
  asked: { bytes: Uint8Array; chain: string }[];
} {
  const asked: { bytes: Uint8Array; chain: string }[] = [];
  return {
    asked,
    address: `0x${"a".repeat(64)}`,
    async signTransaction(input) {
      asked.push(input);
      if (over.fail !== undefined) throw new Error(over.fail);
      return { bytes: over.bytes ?? input.bytes, signature: over.signature ?? "sig-one" };
    },
  };
}

interface Submission {
  transactionBlock: Uint8Array;
  signature: string | string[];
}

/** A node that answers from a table, and remembers every submission. */
function clientThat(
  over: { effects?: unknown; throwOnFirstSubmit?: string; knowsDigest?: boolean } = {},
): SubmitClient & { sent: Submission[]; lookedUp: string[]; waited: string[] } {
  const sent: Submission[] = [];
  const lookedUp: string[] = [];
  const waited: string[] = [];
  const effects = over.effects ?? { status: { status: "success" } };
  return {
    sent,
    lookedUp,
    waited,
    async executeTransactionBlock({ transactionBlock, signature }): Promise<SubmittedTransaction> {
      sent.push({ transactionBlock, signature });
      if (over.throwOnFirstSubmit !== undefined && sent.length === 1) throw new Error(over.throwOnFirstSubmit);
      return { digest: TransactionDataBuilder.getDigestFromBytes(transactionBlock), effects, objectChanges: [] };
    },
    async getTransactionBlock({ digest }): Promise<SubmittedTransaction> {
      lookedUp.push(digest);
      if (over.knowsDigest !== true) throw new Error("no such transaction");
      return { digest, effects, objectChanges: [] };
    },
    async waitForTransaction({ digest }) {
      waited.push(digest);
      return undefined;
    },
  };
}

/** A retry that does not sleep: the waiting is the policy's, and a test should not spend it. */
const NO_WAITING = { sleep: async (): Promise<void> => undefined, random: () => 0 };

test("the wallet is asked to sign the bytes this tool built, and its signature is what is submitted", async () => {
  const payer = payerThat({ signature: "sig-from-the-wallet" });
  const client = clientThat();
  const result = await signAndSubmit(client, payer, {
    network: "mainnet",
    bytes: BYTES,
    refusals: REFUSALS,
    retry: NO_WAITING,
  });

  assert.equal(payer.asked.length, 1, "one transaction asked the wallet for a different number of signatures");
  assert.deepEqual(payer.asked[0]?.bytes, BYTES, "the wallet was asked to sign something else");
  // ⛔ THE WALLET IS TOLD WHICH CHAIN. A wallet connected to the other network refuses rather than
  //    signing a transaction for a chain the person is not on.
  assert.equal(payer.asked[0]?.chain, "sui:mainnet");
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0]?.signature, "sig-from-the-wallet", "something other than the wallet's signature was submitted");
  assert.deepEqual(client.sent[0]?.transactionBlock, BYTES);
  // The digest is read back from the chain's answer, and the wait is for whoever reads it next.
  assert.equal(result.digest, TransactionDataBuilder.getDigestFromBytes(BYTES));
  assert.deepEqual(client.waited, [result.digest]);
});

test("the bytes the wallet answers with are the bytes submitted, base64 or raw", async () => {
  // A wallet may hand back its own copy of what it signed — the standard has it answer the bytes —
  // and some adjust a transaction before signing one. The signature is over THOSE bytes.
  const adjusted = new Uint8Array([1, 1, 2, 3, 5, 8]);
  const payer = payerThat({ bytes: toBase64(adjusted) });
  const client = clientThat();
  await signAndSubmit(client, payer, { network: "testnet", bytes: BYTES, refusals: REFUSALS, retry: NO_WAITING });
  assert.deepEqual(client.sent[0]?.transactionBlock, adjusted, "the bytes the wallet signed were not the bytes sent");
  assert.equal(payer.asked[0]?.chain, "sui:testnet");
});

test("⛔ a wallet that declines is WALLET_REFUSED, and nothing was submitted", async () => {
  const payer = payerThat({ fail: "User rejected the request" });
  const client = clientThat();
  const failure = await signAndSubmit(client, payer, {
    network: "mainnet",
    bytes: BYTES,
    refusals: REFUSALS,
    retry: NO_WAITING,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  // ⛔ A PERSON WHO SAID NO IS NOT A BROKEN WALLET, and a caller that cannot tell them apart shows
  //    the wrong sentence to somebody who did exactly what they meant to.
  assert.ok(failure instanceof NmtsError, "a wallet's refusal came back as something else");
  assert.match(failure.message, /^WALLET_REFUSED: /);
  assert.match(failure.message, /User rejected the request/);
  assert.match(String(failure.nextStep), /Nothing was signed and nothing was spent\./);
  assert.equal(failure.exitCode, 4);
  assert.deepEqual([client.sent.length, client.waited.length], [0, 0], "a refused signature reached the chain");
});

test("⛔ a transaction that executed and FAILED is a refusal, not a digest", async () => {
  const client = clientThat({ effects: { status: { status: "failure", error: "InsufficientCoinBalance" } } });
  const failure = await signAndSubmit(client, payerThat(), {
    network: "mainnet",
    bytes: BYTES,
    refusals: REFUSALS,
    retry: NO_WAITING,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(failure instanceof NmtsError, "a failed execution was reported as a success");
  assert.equal(failure.message, "The chain refused it: InsufficientCoinBalance.");
  assert.equal(failure.nextStep, "The transaction fee was spent.");
});

test("⛔ a submission whose reply was lost is looked up, not signed again", async () => {
  // The first send reaches the chain and the reply never comes back. Re-signing would pay twice for
  // a registration; the digest is a hash of the bytes, so the same transaction can be asked about.
  const client = clientThat({ throwOnFirstSubmit: "fetch failed", knowsDigest: true });
  const payer = payerThat();
  const result = await signAndSubmit(client, payer, {
    network: "mainnet",
    bytes: BYTES,
    refusals: REFUSALS,
    retry: NO_WAITING,
  });
  assert.equal(payer.asked.length, 1, "a lost reply asked the wallet to sign a second time");
  assert.deepEqual(client.lookedUp, [TransactionDataBuilder.getDigestFromBytes(BYTES)]);
  assert.equal(client.sent.length, 1, "the transaction was submitted again although the chain knew it");
  assert.equal(result.digest, TransactionDataBuilder.getDigestFromBytes(BYTES));
});

test("a refusal from the node is not waited out: it is an answer", async () => {
  const client = clientThat({ throwOnFirstSubmit: "Transaction validator signature verification failed" });
  const failure = await signAndSubmit(client, payerThat(), {
    network: "mainnet",
    bytes: BYTES,
    refusals: REFUSALS,
    retry: NO_WAITING,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /signature verification failed/);
  assert.equal(client.lookedUp.length, 0, "a refusal was treated as a dropped line");
  assert.equal(client.sent.length, 1);
});

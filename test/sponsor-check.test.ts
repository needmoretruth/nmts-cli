// The sponsored-upload check: what an operator's server runs before its wallet signs bytes that a
// customer's device built.
//
// ⛔ THE PASSING CASES ARE REAL. `fixtures/sponsor/*.b64` are the three transactions a customer's
//    device sent to the operator's server on testnet (2026-11-10): reserve + register, certify and
//    extend, built by this repository's own upload and extend code and executed by the chain
//    (register 8XLr5kR7n9pypv5PznrqhUtFc7QAK9k7HbHBts5aF3ds, certify
//    E9JtBWV6ntyWQuaucrkGLrZDrF4JiQV2knFnwJzvLbAN, extend ERgCoViTqXrf6QAxeQqXWNzzC3uvQsKJTaCTGRVa1Zk2).
//    `facts.json` is what the chain said then. Nothing here reaches a network.
//
// ⛔ EVERY REFUSAL IS A MUTATION OF A REAL ONE, and each names the code it must be refused with. A
//    refusal test that would pass against a check that accepts everything proves nothing, so
//    `SPONSOR_GUARD_UNDER_TEST=accept-all` swaps the check for one that signs anything: every
//    refusal below must then go red (so does the first test, since that check measures nothing).
//    The last test signs through `signSponsored`, which always runs the real check.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { toBase64 } from "@mysten/sui/utils";
import { verifyTransactionSignature } from "@mysten/sui/verify";

import {
  judgeSponsored,
  type SponsorFacts,
  type SponsorPolicy,
  type SponsorRefusal,
  type SponsorVerdict,
} from "../src/sponsor-check.ts";
import { walletAddress } from "../src/wallet.ts";
import { signSponsored } from "../src/wallet-sign.ts";
import { generateCode } from "./helpers.ts";
import {
  addInput,
  type Argument,
  ATTACKER,
  CERTIFY,
  type Data,
  EXTEND,
  facts,
  insert,
  moveCall,
  mutate,
  OPERATOR,
  pureAddress,
  pureU64,
  REGISTER,
} from "./sponsor-fixtures.ts";

const POLICY: SponsorPolicy = {
  network: "testnet",
  operator: OPERATOR,
  maxBytes: 512 * 1024 * 1024,
  maxEpochs: 53,
  maxWalFrost: 2_000_000_000n,
  maxSuiMist: 100_000_000n,
};

const acceptAll = async (): Promise<SponsorVerdict> => ({
  ok: true,
  spends: { walFrost: "0", suiMist: "0", gasBudgetMist: "0", tipMist: "0", bytes: 0, epochs: 0, calls: [] },
});
const underTest = process.env.SPONSOR_GUARD_UNDER_TEST === "accept-all" ? acceptAll : judgeSponsored;

async function judge(bytes: Uint8Array | string, policy: Partial<SponsorPolicy> = {}, over: Partial<SponsorFacts> = {}): Promise<SponsorVerdict> {
  return underTest(bytes, { ...POLICY, ...policy }, facts(over));
}

async function assertRefused(bytes: Uint8Array | string | Promise<Uint8Array>, code: SponsorRefusal, policy: Partial<SponsorPolicy> = {}, over: Partial<SponsorFacts> = {}): Promise<void> {
  const verdict = await judge(await bytes, policy, over);
  assert.equal(verdict.ok, false, `signed a transaction that should be refused with ${code}`);
  if (verdict.ok) return;
  assert.equal(verdict.code, code, `refused for the wrong reason: ${verdict.reason}`);
  assert.ok(verdict.reason.length > 10 && !verdict.reason.includes("\n"), "the reason is not one line a log can hold");
}

// The recorded register is: 0 redeem the tip from the operator's balance · 1 split the tip ·
// 2 send the rest back · 3 tip to the relay · 4 split the WAL coin in two · 5 reserve_space ·
// 6 destroy_zero · 7 register_blob · 8 destroy_zero · 9 the blob to the operator.

test("the three transactions our own upload and extension sent pass, and what they spend is measured", async () => {
  const register = await judge(REGISTER);
  assert.deepEqual(register, {
    ok: true,
    spends: { walFrost: "1060669", suiMist: "4975382", gasBudgetMist: "4975277", tipMist: "105", bytes: 2097152, epochs: 2, calls: ["reserve_space", "register_blob"] },
  });
  const certify = await judge(CERTIFY);
  assert.equal(certify.ok, true);
  assert.deepEqual(certify.ok && certify.spends.calls, ["certify_blob"]);
  const extend = await judge(EXTEND);
  assert.deepEqual(extend.ok && { wal: extend.spends.walFrost, bytes: extend.spends.bytes, epochs: extend.spends.epochs }, { wal: "530370", bytes: 2097152, epochs: 2 });
});

test("⛔ somebody else as the sender or the gas owner is refused", async () => {
  await assertRefused(mutate(REGISTER, (d) => void (d.sender = ATTACKER)), "SPONSOR_SENDER");
  await assertRefused(mutate(REGISTER, (d) => void (d.gasData.owner = ATTACKER)), "SPONSOR_GAS_OWNER");
});

test("⛔ a gas budget over the cap is refused", async () => {
  await assertRefused(mutate(REGISTER, (d) => void (d.gasData.budget = "1000000000")), "SPONSOR_GAS_BUDGET");
  await assertRefused(REGISTER, "SPONSOR_GAS_BUDGET", { maxGasBudgetMist: 1_000_000n });
});

test("⛔ the policy's own network decides: another system object is refused", async () => {
  const other = `0x${"5e".repeat(32)}`;
  await assertRefused(
    mutate(REGISTER, (d) => {
      const shared = d.inputs[2]?.Object?.SharedObject;
      if (shared) shared.objectId = other;
    }),
    "SPONSOR_NETWORK",
  );
  // The same bytes judged with mainnet's facts: the system object is not mainnet's.
  await assertRefused(REGISTER, "SPONSOR_NETWORK", { network: "mainnet" }, { systemObjectId: other });
});

test("⛔ a coin to anybody but the operator or a relay's tip address is refused", async () => {
  // The relay tip redirected.
  await assertRefused(mutate(REGISTER, (d) => void (d.inputs[1] = pureAddress(ATTACKER))), "SPONSOR_TRANSFER");
  // The change of the tip sent elsewhere.
  await assertRefused(mutate(REGISTER, (d) => void (d.inputs[13] = pureAddress(ATTACKER))), "SPONSOR_TRANSFER");
  // The blob handed to somebody else.
  await assertRefused(mutate(REGISTER, (d) => void (d.inputs[10] = pureAddress(ATTACKER))), "SPONSOR_TRANSFER");
  // The gas coin, the operator's whole WAL coin, or a cut of it added on the end.
  const loot: Argument[] = [{ $kind: "GasCoin", GasCoin: true }, { $kind: "Input", Input: 14 }, { $kind: "NestedResult", NestedResult: [4, 0] }];
  for (const object of loot) {
    await assertRefused(
      mutate(REGISTER, (d) => {
        const to = addInput(d, pureAddress(ATTACKER));
        d.commands.push({ $kind: "TransferObjects", TransferObjects: { objects: [object], address: { $kind: "Input", Input: to } } });
      }),
      "SPONSOR_TRANSFER",
    );
  }
  // WAL sent to a tip address is not a tip.
  await assertRefused(mutate(REGISTER, (d) => {
    d.commands.push({ $kind: "TransferObjects", TransferObjects: { objects: [{ $kind: "NestedResult", NestedResult: [4, 0] }], address: { $kind: "Input", Input: 1 } } });
  }), "SPONSOR_TRANSFER");
});

test("⛔ any call that is not Walrus storage, or Walrus from another package, is refused", async () => {
  await assertRefused(mutate(REGISTER, (d) => void (moveCall(d, 7).package = `0x${"77".repeat(32)}`)), "SPONSOR_CALL");
  await assertRefused(mutate(REGISTER, (d) => void (moveCall(d, 7).function = "delete_blob")), "SPONSOR_CALL");
  await assertRefused(mutate(EXTEND, (d) => void (moveCall(d, 1).module = "staking")), "SPONSOR_CALL");
  await assertRefused(mutate(REGISTER, (d) => {
    d.commands.push({ $kind: "MoveCall", MoveCall: { package: "0x2", module: "pay", function: "split_and_transfer", typeArguments: [], arguments: [{ $kind: "Input", Input: 14 }] } });
  }), "SPONSOR_CALL");
  // The gas coin handed to a Walrus call to pay from.
  await assertRefused(mutate(EXTEND, (d) => void (moveCall(d, 1).arguments[3] = { $kind: "GasCoin", GasCoin: true })), "SPONSOR_CALL");
});

test("⛔ a kind of command an upload never needs is refused", async () => {
  await assertRefused(mutate(REGISTER, (d) => {
    d.commands.push({ $kind: "Publish", Publish: { modules: ["AA=="], dependencies: ["0x1", "0x2"] } });
  }), "SPONSOR_COMMAND");
});

test("⛔ an input that receives, or draws on somebody's allowance, is refused", async () => {
  await assertRefused(mutate(EXTEND, (d) => {
    const owned = d.inputs[3]?.Object?.ImmOrOwnedObject;
    if (owned) d.inputs[3] = { $kind: "Object", Object: { $kind: "Receiving", Receiving: owned } };
  }), "SPONSOR_INPUT");
  await assertRefused(mutate(REGISTER, (d) => {
    const w = d.inputs[11]?.FundsWithdrawal;
    if (w) w.withdrawFrom = { $kind: "SenderAllowance", SenderAllowance: { funder: ATTACKER, allowance: `0x${"a1".repeat(32)}` } };
  }), "SPONSOR_INPUT");
});

test("⛔ a payment coin whose amount the bytes do not bound is refused", async () => {
  // The whole WAL coin, not a cut of it.
  await assertRefused(mutate(EXTEND, (d) => void (moveCall(d, 1).arguments[3] = { $kind: "Input", Input: 3 })), "SPONSOR_UNBOUNDED");
  // A cut that a merge grew before it paid.
  await assertRefused(mutate(REGISTER, (d) => {
    insert(d, 5, { $kind: "MergeCoins", MergeCoins: { destination: { $kind: "NestedResult", NestedResult: [4, 1] }, sources: [{ $kind: "Input", Input: 14 }] } });
  }), "SPONSOR_UNBOUNDED");
});

test("⛔ buying storage that is not written into, or writing into storage already held, is refused", async () => {
  // Reserve only: the register, the destroy and the transfer after it removed.
  await assertRefused(mutate(REGISTER, (d) => void d.commands.splice(7)), "SPONSOR_STORAGE");
  // Register into a resource the operator already holds instead of the one just reserved.
  await assertRefused(mutate(REGISTER, (d) => {
    const held = addInput(d, { $kind: "Object", Object: { $kind: "ImmOrOwnedObject", ImmOrOwnedObject: { objectId: `0x${"5a".repeat(32)}`, version: "1", digest: "11111111111111111111111111111111" } } });
    moveCall(d, 7).arguments[1] = { $kind: "Input", Input: held };
  }), "SPONSOR_STORAGE");
});

test("⛔ more space reserved than the blob needs, or a size that cannot be read, is refused", async () => {
  await assertRefused(mutate(REGISTER, (d) => void (d.inputs[3] = pureU64(10n * 74_042_000n))), "SPONSOR_SIZE");
  await assertRefused(EXTEND, "SPONSOR_SIZE", {}, { blobSize: async () => null });
});

test("⛔ the policy's limits: size, term, WAL and SUI", async () => {
  await assertRefused(REGISTER, "SPONSOR_SIZE", { maxBytes: 1024 * 1024 });
  await assertRefused(EXTEND, "SPONSOR_SIZE", { maxBytes: 1024 * 1024 });
  await assertRefused(REGISTER, "SPONSOR_EPOCHS", { maxEpochs: 1 });
  await assertRefused(EXTEND, "SPONSOR_EPOCHS", { maxEpochs: 1 });
  await assertRefused(REGISTER, "SPONSOR_WAL", { maxWalFrost: 1_000_000n });
  await assertRefused(EXTEND, "SPONSOR_WAL", { maxWalFrost: 500_000n });
  // A tip far larger than the relay asks spends SUI past the cap even when the gas budget fits.
  await assertRefused(mutate(REGISTER, (d) => {
    d.inputs[11] = { ...d.inputs[11], FundsWithdrawal: { ...d.inputs[11]?.FundsWithdrawal, reservation: { $kind: "MaxAmountU64", MaxAmountU64: "90000000" } } } as Data["inputs"][number];
    d.inputs[12] = pureU64(90_000_000n);
  }), "SPONSOR_SUI", { maxSuiMist: 50_000_000n, maxGasBudgetMist: 10_000_000n });
  await assertRefused(REGISTER, "SPONSOR_SUI", { maxSuiMist: 4_975_381n, maxGasBudgetMist: 10_000_000n });
});

test("⛔ bytes that are not a transaction, or do no Walrus work, are refused", async () => {
  await assertRefused(new Uint8Array([1, 2, 3]), "SPONSOR_NOT_A_TRANSACTION");
  await assertRefused(mutate(REGISTER, (d) => void d.commands.splice(4)), "SPONSOR_EMPTY");
});

test("signSponsored judges first, signs only what passed, and the signature verifies as the operator's", async () => {
  // An account standing in for the operator, and the recorded extension re-addressed to its wallet.
  const code = await generateCode();
  const me = await walletAddress(code);
  const bytes = await mutate(EXTEND, (d) => {
    d.sender = me;
    d.gasData.owner = me;
  });
  const policy = { ...POLICY, operator: me };
  const signed = await signSponsored({ network: "testnet", code, wallet: 0, bytes, policy, facts: facts() });
  assert.equal(signed.bytes, toBase64(bytes), "the bytes signed are not the bytes that were checked");
  const signer = await verifyTransactionSignature(bytes, signed.signature);
  assert.equal(signer.toSuiAddress(), me);
  assert.equal(signed.spends.walFrost, "530370");
  if (underTest !== judgeSponsored) return;
  // Bytes the check refuses never reach the key; neither does a policy that names another wallet.
  const stolen = await mutate(EXTEND, (d) => {
    d.sender = me;
    d.gasData.owner = me;
    const to = addInput(d, pureAddress(ATTACKER));
    d.commands.push({ $kind: "TransferObjects", TransferObjects: { objects: [{ $kind: "Input", Input: 3 }], address: { $kind: "Input", Input: to } } });
  });
  await assert.rejects(signSponsored({ network: "testnet", code, wallet: 0, bytes: stolen, policy, facts: facts() }), /SPONSOR_REFUSED: SPONSOR_TRANSFER/);
  await assert.rejects(signSponsored({ network: "testnet", code, wallet: 1, bytes, policy, facts: facts() }), /SPONSOR_REFUSED: SPONSOR_SENDER/);
});

// `nmts put --pay wallet` — the upload whose storage the person's own wallet buys.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. Everything this path can get wrong costs money nobody can
//    get back: a review that arrives after the signature, a shortfall found after the agreement, a
//    `--dry-run` that reaches a signer, a part signed that was not the part planned, and a commit
//    that lets the server believe the treasury paid. The chain and both signatures are seams; the
//    signers below record what they were asked, or fail the test by being called at all.
//
// ⚠ WHAT THEY DO NOT PROVE. No transaction is built, signed or executed here. The order, the
//   arithmetic and the shapes handed to the signer and to the server are what is held; whether
//   the chain accepts them cannot be known without spending WAL.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { put } from "../src/commands/put.ts";
import { tip } from "../src/commands/tip.ts";
import { testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { sealedLenFor } from "../src/seal.ts";
import type { StorageResource } from "../src/shared/lib/storage-control/chain.ts";
import { planAndPrice } from "../src/upload-price.ts";
import { coinAmount } from "../src/wallet.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { FEE_MIST, MAINNET, NOW, refusal, withWalletAgreed } from "./fake-extend.ts";
import { FILE, fakeReads, putWalletOpts, recordingSigners, refuseToSign } from "./fake-put-wallet.ts";
import { grantConsents } from "./helpers.ts";
import { apiThat } from "./upload-fixture.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** This file's drive, bound in once — every run below shares it. */
const opts = (out: { write: (line: string) => void }, extra: Record<string, unknown> = {}): Parameters<typeof put>[1] =>
  putWalletOpts(drive, out, extra);

// ── the review, before anything is signed ─────────────────────────────────────────────────────

test("⛔ --dry-run prints the whole review — price, tip, fee, balances, epochs and days — and reaches no signer", async () => {
  await withWalletAgreed(drive, "put-wallet-dry", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    const sign = refuseToSign("--dry-run reached a signer");
    assert.equal(await put(FILE, opts(out, { dryRun: true, epochs: "4", sign })), 0);
    const text = out.lines.join("\n");
    // Ten bytes seal to one part; the fake quotes sealedLen×4 storage + sealedLen write.
    const sealed = sealedLenFor(planAndPrice(10, 64 * 2 ** 20, "padme").sealFor({ partIndex: 0, offset: 0, length: 10 }));
    const wal = BigInt(sealed) * 4n + BigInt(sealed);
    assert.match(text, new RegExp(`→  ${coinAmount(wal).replace(".", "\\.")} WAL from the wallet`));
    assert.match(text, /Stored for 4 epochs — 56 days — until epoch 1204\./);
    assert.match(text, /Relay tip 0\.000001 SUI/);
    assert.match(text, /Chain fee about 0\.003 SUI per register signature/);
    assert.match(text, /holds 10000000 WAL and 1 SUI/);
    assert.match(text, /not from credits/);
    assert.match(text, /not carry the recovery list's storage-network copy/);
    assert.match(text, /Nothing was signed and nothing was sent/);
    assert.equal(sign.calls, 0);
  });
});

test("--dry-run --json says who pays and what it costs, in base units as strings", async () => {
  await withWalletAgreed(drive, "put-wallet-dry-json", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    assert.equal(await put(FILE, opts(out, { dryRun: true, json: true, sign: refuseToSign("json dry run signed") })), 0);
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const at = (k: string): unknown => Reflect.get(parsed, k);
    assert.equal(at("dryRun"), true);
    assert.equal(at("paidFrom"), "wallet");
    assert.equal(at("signed"), false);
    assert.equal(at("epochs"), 2);
    assert.equal(at("days"), "28 days");
    assert.equal(typeof at("priceFrost"), "string");
    assert.equal(at("feeMist"), FEE_MIST.toString());
    assert.deepEqual(at("storage"), { kind: "buy" });
  });
});

// ── the wallet against the price, before the agreement ────────────────────────────────────────

test("⛔ a wallet short of WAL is refused with both numbers, before the agreement and before any signature", async () => {
  // ⛔ NO `wallet` GRANT IN THIS SANDBOX — exit 4, not 5, proves the shortfall came first.
  await withSandbox(drive, "put-wallet-short", async (code) => {
    await drive.serve(code, []);
    const sign = refuseToSign("a short wallet reached a signer");
    const failure = await refusal(put(FILE, opts(collect(), { readChain: () => fakeReads({ wallet: { wal: 1n } }), sign })));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /holds 0\.000000001 WAL and this upload costs [0-9.]+ WAL/);
    assert.match(String(failure.nextStep), /Nothing was signed and nothing was sent\. Send WAL to 0x[0-9a-f]+/);
    assert.equal(sign.calls, 0);
  });
});

test("⛔ an unread balance is said, not treated as zero — the run goes on to the agreement", async () => {
  await withSandbox(drive, "put-wallet-unread", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    const failure = await refusal(
      put(FILE, opts(out, { readChain: () => fakeReads({ wallet: { wal: null } }), sign: refuseToSign("no agreement, yet signed") })),
    );
    // Exit 5: it got as far as asking for the agreement, which means the unread WAL did not refuse it.
    assert.equal(failure.exitCode, 5);
    assert.match(out.lines.join("\n"), /A balance could not be read — WAL: .*That is not zero/);
  });
});

test("⛔ without a wallet agreement the review is printed and then it stops, unsigned", async () => {
  await withSandbox(drive, "put-wallet-no-grant", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    const sign = refuseToSign("signed without an agreement");
    const failure = await refusal(put(FILE, opts(out, { sign })));
    assert.equal(failure.exitCode, 5);
    assert.match(failure.message, /Use the wallet this NMTS key derives/);
    assert.match(out.lines.join("\n"), /from the wallet this NMTS key derives — not from credits/);
    assert.equal(sign.calls, 0);
  });
});

// ── what is signed, and what the server is told ───────────────────────────────────────────────

test("⛔ the signed shapes are the planned parts, and the commit says the storage is the person's", async () => {
  await withWalletAgreed(drive, "put-wallet-signs", async (code) => {
    await drive.serve(code, []);
    const sign = recordingSigners();
    const bodies: { parts: readonly Record<string, unknown>[] }[] = [];
    const { api } = apiThat({
      createItem: async (body) => {
        bodies.push(body);
        return { id: "item-w" };
      },
    });
    const out = collect();
    // Ten bytes in parts of four: 4 + 4 + 2, so three registrations and three certifications.
    assert.equal(await put(FILE, opts(out, { partSize: 4, epochs: 3, sign, api })), 0);
    const { plan, sealFor } = planAndPrice(10, 4, "padme");
    const expected = plan.map((range) => sealedLenFor(sealFor(range)));
    assert.deepEqual(
      sign.registered.map((a) => a.part.sealedLen),
      expected,
      "what was signed is not what was planned",
    );
    for (const asked of sign.registered) {
      assert.equal(asked.epochs, 3);
      assert.deepEqual(asked.storage, { kind: "buy" });
      assert.equal(asked.relayUrl, "https://relay.example");
      assert.ok(asked.part.blobId.startsWith("blob-"), "the blob id is not the encoder's");
    }
    assert.deepEqual(sign.certified, ["0xblob-1", "0xblob-2", "0xblob-3"]);
    // ⛔ THE COMMIT: no reservation named, the person's ownership, the blob object and the end epoch.
    assert.equal(bodies.length, 1);
    const parts = bodies[0]?.parts ?? [];
    assert.equal(parts.length, 3);
    for (const [i, part] of parts.entries()) {
      assert.equal(part["sponsored_ledger_id"], undefined, "a wallet-paid part named a reservation");
      assert.equal(part["owner_kind"], 0);
      assert.equal(part["sui_object_id"], `0xblob-${i + 1}`);
      assert.equal(part["expiry_epoch"], MAINNET.current + 3);
      assert.equal(part["sealed_len"], expected[i]);
    }
    // And the file is in the list, under its name.
    const written = await drive.lastWritten(code);
    assert.ok(written.some((e) => e.name === "notes.txt" && e.id === "item-w"));
    assert.match(out.lines.join("\n"), /saved as notes\.txt/);
  });
});

test("running it again after every part is signed signs nothing more and commits once", async () => {
  await withWalletAgreed(drive, "put-wallet-resume", async (code) => {
    await drive.serve(code, []);
    const first = recordingSigners();
    let commits = 0;
    const { api } = apiThat({
      createItem: async () => {
        commits += 1;
        // The FIRST commit dies on the way back; the records keep the signed parts.
        if (commits === 1) throw new Error("the answer was lost");
        return { id: "item-r" };
      },
    });
    const failure = await refusal(put(FILE, opts(collect(), { partSize: 4, sign: first, api })));
    assert.match(failure.message, /saving it to the drive failed/);
    assert.equal(first.registered.length, 3);
    const second = refuseToSign("a resumed run signed again");
    const out = collect();
    assert.equal(await put(FILE, opts(out, { partSize: 4, sign: second, api })), 0);
    assert.equal(second.calls, 0);
    assert.equal(commits, 2);
    assert.match(out.lines.join("\n"), /finished an upload a previous run had already signed for/);
  });
});

// ── a held storage resource ───────────────────────────────────────────────────────────────────

const HELD: StorageResource[] = [
  { objectId: "0xended", startEpoch: 1100, endEpoch: 1150, sizeBytes: 5 * 1024 ** 3 },
  { objectId: "0xsmall", startEpoch: 1190, endEpoch: 1260, sizeBytes: 64 * 1024 ** 2 },
  { objectId: "0xbig", startEpoch: 1195, endEpoch: 1230, sizeBytes: 1024 ** 3 },
];

test("⛔ --storage fit cuts the smallest usable resource that fits and says what stays free", async () => {
  await withWalletAgreed(drive, "put-wallet-fit", async (code) => {
    await drive.serve(code, []);
    const sign = recordingSigners();
    const out = collect();
    assert.equal(await put(FILE, opts(out, { storage: "fit", readChain: () => fakeReads({ resources: HELD }), sign })), 0);
    const asked = sign.registered[0];
    assert.ok(asked !== undefined);
    const encoded = asked.part.sealedLen * 5;
    assert.deepEqual(
      { kind: asked.storage.kind, objectId: asked.storage.kind === "reuse" ? asked.storage.objectId : null, cut: asked.storage.kind === "reuse" ? asked.storage.cutToBytes : null },
      { kind: "reuse", objectId: "0xsmall", cut: encoded },
    );
    const text = out.lines.join("\n");
    assert.match(text, /Storage comes from resource 0xsmall/);
    assert.match(text, new RegExp(`Cut to fit: ${64 * 1024 ** 2 - encoded} bytes stay free`));
    // The write is charged; the storage is not.
    assert.match(text, /the WAL above is the write alone/);
  });
});

test("--storage whole binds the resource and says how many bytes go in with the file", async () => {
  await withWalletAgreed(drive, "put-wallet-whole", async (code) => {
    await drive.serve(code, []);
    const sign = recordingSigners();
    const out = collect();
    assert.equal(await put(FILE, opts(out, { storage: "whole", readChain: () => fakeReads({ resources: HELD }), sign })), 0);
    const storage = sign.registered[0]?.storage;
    assert.ok(storage !== undefined && storage.kind === "reuse");
    assert.equal(storage.cutToBytes, null);
    assert.match(out.lines.join("\n"), /Used whole: \d+ bytes beyond this file are bound with it/);
  });
});

test("an object id names one resource; one that is ended or missing is refused before anything is signed", async () => {
  await withWalletAgreed(drive, "put-wallet-object", async (code) => {
    await drive.serve(code, []);
    const sign = recordingSigners();
    const big = "0x" + "b".repeat(64);
    const resources = [{ ...HELD[2], objectId: big } as StorageResource, HELD[0]];
    assert.equal(await put(FILE, opts(collect(), { storage: big, readChain: () => fakeReads({ resources }), sign })), 0);
    assert.equal(sign.registered[0]?.storage.kind, "reuse");
    const ended = "0x" + "e".repeat(64);
    const refuse = refuseToSign("an ended resource reached the signer");
    const failure = await refusal(
      put(FILE, opts(collect(), { storage: ended, readChain: () => fakeReads({ resources: [{ ...HELD[0], objectId: ended } as StorageResource] }), sign: refuse })),
    );
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /cannot hold this part until epoch 1202/);
    assert.equal(refuse.calls, 0);
  });
});

test("the review mentions held resources when there are any, and buys new storage unless asked", async () => {
  await withWalletAgreed(drive, "put-wallet-hint", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    assert.equal(await put(FILE, opts(out, { dryRun: true, readChain: () => fakeReads({ resources: HELD }), sign: refuseToSign("dry") })), 0);
    assert.match(out.lines.join("\n"), /also holds 2 free storage resources/);
  });
});

// ── the standing share, after the payment ─────────────────────────────────────────────────────

/** The published address and the gift's digest, both shaped like real ones. */
const DEV = `0x${"d".repeat(64)}`;
const GIFT = "5rTuLm9wQ2xVc7Yb1Kd8FgHj3NpZa6Se4RvXt2WqMh7B";

/** What one default run of ten bytes pays in WAL: two epochs of storage plus the write. */
function walPaid(): bigint {
  const sealed = sealedLenFor(planAndPrice(10, 64 * 2 ** 20, "padme").sealFor({ partIndex: 0, offset: 0, length: 10 }));
  return BigInt(sealed) * 2n + BigInt(sealed);
}

test("the standing share of what the upload paid goes to the developer, after the upload is saved", async () => {
  await withSandbox(drive, "put-wallet-tip", async (code) => {
    grantConsents(testConfigDir("put-wallet-tip"), "plain-env", "wallet", "donate");
    await drive.serve(code, []);
    assert.equal(await tip("2.5", { server: drive.base, network: "testnet", write: () => undefined, now: NOW }), 0);
    const gifts: bigint[] = [];
    const out = collect();
    const answer = await put(
      FILE,
      opts(out, {
        sign: recordingSigners(),
        tip: {
          readDonation: async () => ({ devAddress: DEV, sendEnabled: true, walEnabled: true }),
          sign: async ({ shape }: { shape: { amountBaseUnits: bigint } }) => {
            gifts.push(shape.amountBaseUnits);
            return GIFT;
          },
        },
      }),
    );
    assert.equal(answer, 0);
    // 2.5 % of what the wallet actually paid for this upload — storage and write, not a quote.
    const expected = (walPaid() * 25n) / 1000n;
    assert.ok(expected > 0n, "the fixture pays too little for a share to be worth anything");
    assert.deepEqual(gifts, [expected]);
    assert.match(out.lines.join("\n"), /standing 2\.5 % gift — [0-9.]+ WAL — went to the developer/);
  });
});

test("⛔ an account that set no share has nothing sent for it", async () => {
  await withWalletAgreed(drive, "put-wallet-no-tip", async (code) => {
    await drive.serve(code, []);
    const out = collect();
    let gifts = 0;
    const answer = await put(
      FILE,
      opts(out, {
        sign: recordingSigners(),
        tip: {
          readDonation: async () => {
            throw new Error("it asked where to send a gift nobody set");
          },
          sign: async () => {
            gifts += 1;
            return GIFT;
          },
        },
      }),
    );
    assert.equal(answer, 0);
    assert.equal(gifts, 0);
    assert.doesNotMatch(out.lines.join("\n"), /gift/);
  });
});

// ── refusals that cost nothing ────────────────────────────────────────────────────────────────

test("a term the network will not sell is refused with the ceiling", async () => {
  await withWalletAgreed(drive, "put-wallet-ceiling", async (code) => {
    await drive.serve(code, []);
    const failure = await refusal(put(FILE, opts(collect(), { epochs: "60", readChain: () => fakeReads({ maxAhead: 53 }), sign: refuseToSign("x") })));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /at most 53 epochs ahead/);
  });
});

test("⛔ --epochs and --storage without --pay wallet are refused, and an unknown payer is refused", async () => {
  await withSandbox(drive, "put-wallet-flags", async () => {
    for (const [extra, why] of [
      [{ pay: undefined, epochs: "4" }, /--epochs only applies with --pay wallet/],
      [{ pay: "credits", storage: "fit" }, /--storage only applies with --pay wallet/],
      [{ pay: "cash" }, /--pay takes credits or wallet/],
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
});

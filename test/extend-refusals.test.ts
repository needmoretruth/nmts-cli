// `nmts extend` — everything it refuses to do, and why each refusal is a refusal rather than a
// quiet adjustment.
//
// ⛔ EVERY ONE OF THESE COSTS MONEY IF IT GOES THE OTHER WAY. Clamping a length somebody asked for
//    spends a different amount than they asked to spend; extending a file that is nowhere near its
//    deadline spends now for time it does not need; buying more epochs than the NMTS server will
//    record leaves storage really extended and a drive showing the old date. So each of these
//    tests hands the command a signer that fails the test by being called at all.
//
// Split from `extend.test.ts` on the length gate — the honest reason, and the line that means
// something: what the command DOES on one side, what it will NOT do on the other.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { extend } from "../src/commands/extend.ts";
import { collect, entry, startFakeDrive } from "./fake-drive.ts";
import {
  extendOpts,
  fakeChain,
  preview,
  recordingSigner,
  refusal,
  refuseToSign,
  servePhoto,
  withWalletAgreed,
  type FakeChain,
} from "./fake-extend.ts";
import type { BlobLease } from "../src/extend-plan.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (
  out: { write: (line: string) => void },
  extra: Partial<Parameters<typeof extend>[1]> = {},
): Parameters<typeof extend>[1] => extendOpts(drive, out, extra);

// ── a file that is not running out ────────────────────────────────────────────────────────────

test("⛔ a file that is nowhere near its deadline is not extended by accident", async () => {
  await withWalletAgreed(drive, "extend-not-expiring", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "far.bin", size: 10 })]);
    // Ends at 1240, forty epochs past the current one and far outside the three-epoch warning
    // window — but still inside what the network will sell (the ceiling here is 1200 + 53), so
    // the only thing standing between this file and a payment is the check under test.
    const far: BlobLease[] = [{ objectId: "0xblob-far", size: 1_000_000, endEpoch: 1240 }];
    drive.extendPreview = preview(far);
    const chain = (): FakeChain => fakeChain({ leases: far });

    const sign = refuseToSign("it extended a file that was not running out");
    const failure = await refusal(
      extend("far.bin", opts(collect(), { epochs: 2, readChain: chain, sign })),
    );
    assert.equal(sign.calls, 0, "it signed for a file nobody said to extend early");
    assert.equal(failure.exitCode, 4);
    assert.match(String(failure.nextStep), /--yes/);

    // ⭐ AND `--yes` STILL BUYS IT. Extending early loses nothing — the epochs are added to what is
    //    left — so this is a refusal to spend by accident, not a refusal on principle.
    const willing = recordingSigner();
    const out = collect();
    assert.equal(
      await extend("far.bin", opts(out, { epochs: 2, yes: true, readChain: chain, sign: willing })),
      0,
    );
    assert.equal(willing.asked.length, 1, "--yes did not go through with it");
  });
});

// ── the ceilings ──────────────────────────────────────────────────────────────────────────────

test("⛔ it refuses a length the network will not sell, rather than clamping it", async () => {
  await withWalletAgreed(drive, "extend-headroom", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("it signed for a length the network refuses");
    // maxAhead 6 from epoch 1200 puts the ceiling at 1206, and the furthest lease already reaches
    // 1204 — so two epochs is all there is to buy.
    const chain = (): FakeChain => fakeChain({ maxAhead: 6 });
    const failure = await refusal(
      extend("photos/a.jpg", opts(collect(), { epochs: 5, readChain: chain, sign })),
    );
    assert.equal(sign.calls, 0);
    assert.match(failure.message, /at most 2 more epochs/);
    assert.match(String(failure.nextStep), /--epochs 2/);
  });
});

test("⛔ an extension longer than the server will record is refused before it is paid for", async () => {
  await withWalletAgreed(drive, "extend-recordable", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("it bought storage the drive could never be told about");
    // The network would sell it — headroom here is 1,000 epochs — and the NMTS server refuses to
    // record more than 104, which would leave storage really extended and a drive showing the old
    // date. ⛔ Discovering that from a 400 AFTER the signature is the failure this prevents.
    const chain = (): FakeChain => fakeChain({ maxAhead: 1_000 });
    const failure = await refusal(
      extend("photos/a.jpg", opts(collect(), { epochs: 105, readChain: chain, sign })),
    );
    assert.equal(sign.calls, 0);
    assert.match(failure.message, /at most 104 epochs/);
  });
});

// ── nothing to extend ─────────────────────────────────────────────────────────────────────────

test("⛔ a file whose storage this account did not buy is refused, with which of the two it is", async () => {
  await withWalletAgreed(drive, "extend-treasury", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "old.bin", size: 10 })]);
    drive.extendPreview = { item_id: "a", targets: [], treasury_parts: 2, untracked_parts: 1 };
    const sign = refuseToSign("it signed for a file with nothing to extend");
    const failure = await refusal(extend("old.bin", opts(collect(), { sign })));
    assert.equal(sign.calls, 0);
    assert.match(String(failure.nextStep), /2 parts are on storage NMTS paid for/);
    assert.match(String(failure.nextStep), /1 part has no recorded storage object/);
  });
});

test("⛔ a storage term that has already ended is not sold more time", async () => {
  await withWalletAgreed(drive, "extend-lapsed", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "gone.bin", size: 10 })]);
    const done: BlobLease[] = [{ objectId: "0xblob-gone", size: 1_000, endEpoch: 1199 }];
    drive.extendPreview = preview(done);
    const sign = refuseToSign("it paid to extend a lease that was over");
    const failure = await refusal(
      extend("gone.bin", opts(collect(), { readChain: () => fakeChain({ leases: done }), sign })),
    );
    assert.equal(sign.calls, 0);
    assert.match(failure.message, /already ended/);
  });
});


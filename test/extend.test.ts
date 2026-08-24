// `nmts extend` — the one command in this tool that signs, and the only one that spends from a
// wallet instead of from credits.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. Everything this command can get wrong costs somebody money
//    they cannot get back: a price quoted from the wrong arithmetic, a `--dry-run` that touches a
//    key, and a signature made before anybody agreed to signing. The refusals — a file that is not
//    running out, a length the network will not sell, a term that is already over — are next door
//    in `extend-refusals.test.ts`, split off because one file of both was over the length gate.
//
// ⛔ THE CHAIN AND THE SIGNATURE ARE BOTH SUPPLIED. The reads are a seam because a test that
//    talked to a live storage network could not run offline and could never be asked to be at its
//    own ceiling; the signature is a SEPARATE seam because "did this run sign anything" is the
//    single most important question here, and it deserves an answer that is not a guess about
//    which method ran.
//
// ⚠ WHAT THEY DO NOT PROVE. No transaction is built, signed or executed anywhere below. The
//   arithmetic, the order of operations and the shape of both server calls are what is held here;
//   whether the bytes the SDK signs are accepted by the chain is not, and cannot be without
//   spending real WAL. `extend-sign.test.ts` covers the one part of that path which can be checked
//   for nothing: that the wallet doing the signing is the account's own.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { extend } from "../src/commands/extend.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import {
  extendOpts,
  fakeChain,
  recordingSigner,
  refusal,
  refuseToSign,
  servePhoto,
  withWalletAgreed,
  type FakeChain,
} from "./fake-extend.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** This file's drive, bound in once — every run below shares it. */
const opts = (
  out: { write: (line: string) => void },
  extra: Partial<Parameters<typeof extend>[1]> = {},
): Parameters<typeof extend>[1] => extendOpts(drive, out, extra);

// ── the price ─────────────────────────────────────────────────────────────────────────────────

test("⛔ the price and the dates come from this tool's own epoch arithmetic, not the optimistic edge", async () => {
  // The numbers are written out rather than recomputed here. The clock says epoch 1200, a
  // fortnight each, and does NOT say how far into 1200 we are — so a term ending at 1202 has
  // (2-1)×14 = 14 days left AT LEAST, and four more epochs put it at 1206, (6-1)×14 = 70 days.
  // ⛔ Counting whole epochs instead — the edge `expiry.ts` refuses — would print 28 and 84 here,
  //    which is the defect that once told a file it had 28 days when the chain said 23.
  await withWalletAgreed(drive, "extend-price", async (code) => {
    await servePhoto(drive, code);
    const out = collect();
    assert.equal(await extend("photos/a.jpg", opts(out, { epochs: 4, dryRun: true })), 0);
    const text = out.lines.join("\n");
    assert.match(text, /Storage ends at epoch 1202 — 14 days or more left\./);
    assert.match(text, /moves that to epoch 1206 — 70 days or more left\./);
    // 1,000,000 + 500,000 base units, four epochs each = 6,000,000 FROST = 0.006 WAL, printed
    // exactly rather than rounded: money that reads as zero when it is not is unforgivable.
    assert.match(text, /Price 0\.006 WAL for 2 stored blobs/);
  });
});

test("⛔ it says the money comes from a wallet, not from credits, before anything is agreed to", async () => {
  await withSandbox(drive, "extend-says-wallet", async (code) => {
    await servePhoto(drive, code);
    const out = collect();
    // No `wallet` agreement in this sandbox: the run must stop, and the sentence must already
    // have been printed by then. A warning that arrives after the refusal is a warning nobody read.
    await refusal(extend("photos/a.jpg", opts(out, { epochs: 2, sign: refuseToSign("signed without an agreement") })));
    const text = out.lines.join("\n");
    assert.match(text, /paid in WAL from the wallet this account code derives — not from credits/);
  });
});

// ── what --dry-run may not do ─────────────────────────────────────────────────────────────────

test("⛔ --dry-run prices it, signs nothing, records nothing, and needs no agreement", async () => {
  await withSandbox(drive, "extend-dry-run", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("--dry-run reached the signer");
    const out = collect();
    // ⛔ NO `wallet` GRANT IN THIS SANDBOX. A dry run that asked for one would teach somebody to
    //    agree to signing in order to read a price, which is the exact shape of a consent ladder
    //    that stops meaning anything.
    assert.equal(await extend("photos/a.jpg", opts(out, { epochs: 2, dryRun: true, sign })), 0);
    assert.equal(sign.calls, 0, "it reached the signer");
    assert.equal(
      drive.calls.filter((c) => c.startsWith("POST")).length,
      0,
      "it told the server about an extension it never made",
    );
    assert.match(out.lines.join("\n"), /Nothing was signed and nothing was charged/);
  });
});

// ── the agreement ─────────────────────────────────────────────────────────────────────────────

test("⛔ nothing is signed until this machine has agreed to signing", async () => {
  await withSandbox(drive, "extend-no-consent", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("it signed with no agreement on this machine");
    const out = collect();
    const failure = await refusal(extend("photos/a.jpg", opts(out, { epochs: 2, sign })));
    assert.equal(sign.calls, 0, "it signed before anybody agreed to signing");
    assert.equal(failure.exitCode, 5, "the exit code for waiting on a person is 5");
    assert.match(failure.message, /wallet/i);
    assert.match(String(failure.nextStep), /consent grant wallet/);
    assert.equal(
      drive.extendRecorded.length,
      0,
      "it recorded an extension that was never signed",
    );
  });
});

test("the price is read BEFORE the signature, and the signature before the server is told", async () => {
  await withWalletAgreed(drive, "extend-order", async (code) => {
    await servePhoto(drive, code);
    const chain = fakeChain();
    const sign = recordingSigner();
    const out = collect();
    assert.equal(await extend("photos/a.jpg", opts(out, { epochs: 3, readChain: () => chain, sign })), 0);
    // ⛔ A quote taken after a signature is a receipt, not a price.
    assert.deepEqual(chain.calls, ["readWindow", "readLeases 0xblob-a,0xblob-b", "quote 3"]);
    assert.deepEqual(sign.asked, [{ objectIds: ["0xblob-a", "0xblob-b"], epochs: 3 }]);
    assert.deepEqual(drive.extendRecorded, [
      { epochs: 3, tx_digest: "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz" },
    ]);
  });
});

// ── when the note of it does not land ─────────────────────────────────────────────────────────

test("⛔ a failure to RECORD an extension is never reported as a failure to extend", async () => {
  await withWalletAgreed(drive, "extend-record-fails", async (code) => {
    await servePhoto(drive, code);
    drive.extendRecordFails = true;
    const out = collect();
    const code_ = await extend("photos/a.jpg", opts(out, { epochs: 2, sign: recordingSigner() }));
    const text = out.lines.join("\n");
    assert.equal(code_, 1, "a run whose bookkeeping failed must not answer success");
    assert.match(text, /The storage IS extended and the payment has been made/);
    // ⛔ THE SENTENCE THAT KEEPS SOMEBODY FROM PAYING TWICE.
    assert.match(text, /Do not run this command again for this file/);
  });
});

// ── the machine-readable answer ───────────────────────────────────────────────────────────────

test("--json says what was signed, in units a program cannot round away", async () => {
  await withWalletAgreed(drive, "extend-json", async (code) => {
    await servePhoto(drive, code);
    const out = collect();
    // ⛔ THE PRICE IS ONE PAST WHAT A JAVASCRIPT NUMBER HOLDS (2^53 + 1), which is the only kind of
    //    input that can tell a string carrying exact base units from a string made out of a number
    //    that already lost a digit. A base unit is a billionth of a WAL, so this is not an absurd
    //    quantity — it is about 9 million WAL — and the rounding it catches is silent.
    const huge = 9_007_199_254_740_993n;
    const chain = (): FakeChain => fakeChain({ priceFrost: huge });
    assert.equal(
      await extend(
        "photos/a.jpg",
        opts(out, { epochs: 4, json: true, readChain: chain, sign: recordingSigner() }),
      ),
      0,
    );
    const parsed: unknown = JSON.parse(out.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const at = (name: string): unknown => Reflect.get(parsed, name);
    assert.equal(at("priceFrost"), "9007199254740993", "base units must survive exactly — a JSON number rounds");
    assert.equal(at("priceWal"), "9007199.254740993");
    assert.equal(at("paidFrom"), "wallet");
    assert.equal(at("endEpoch"), 1202);
    assert.equal(at("newEndEpoch"), 1206);
    assert.equal(at("signed"), true);
    assert.equal(at("recorded"), true);
  });
});

// ── a claim that has stopped being true ───────────────────────────────────────────────────────

test("⛔ nothing in this tool still tells a reader that no command here signs", async () => {
  // ⛔ IT WAS PRINTED TO PEOPLE, NOT ONLY WRITTEN IN A COMMENT. `nmts wallet` and `nmts expiring`
  //    both ended with "No command in this tool signs anything", which was true the day it was
  //    written and became false the moment this command landed. A retired claim is worse than no
  //    claim: somebody reads it, believes the tool cannot spend from a wallet, and hands it to an
  //    agent on that basis.
  //
  // ⛔ THE TWO DOCUMENTS ARE READ TOO, and the first time this ran they were where it hid. This
  //    test was written to walk `src/` only, and said so — "README.md and AGENTS.md carry prose of
  //    their own that this does not judge". Both of them then turned out to be carrying the
  //    sentence: the README said "No command in this version signs anything with the wallet" and
  //    AGENTS.md said "No command signs yet". They are the two files a person and an agent
  //    actually read before deciding whether to hand this tool an account, so leaving them out put
  //    the exemption exactly where the claim did the most damage.
  //
  // ⚠ WHAT IT STILL CANNOT DO. It matches one retired sentence, not truth. Whether some other
  //   paragraph has quietly become false is a person's read.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const docs = fileURLToPath(new URL("..", import.meta.url));
  const retired = /no command (in this (tool|version)|here)[^.]{0,40}sign/i;

  const found: string[] = [];
  let judged = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "shared") continue; // copied byte for byte from the browser; the original owns it
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts")) continue;
      judged += 1;
      readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (retired.test(line)) found.push(`${name}:${i + 1} ${line.trim()}`);
        });
    }
  };
  walk(root);
  for (const doc of ["README.md", "AGENTS.md"]) {
    judged += 1;
    readFileSync(join(docs, doc), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (retired.test(line)) found.push(`${doc}:${i + 1} ${line.trim()}`);
      });
  }
  // ⛔ "0 found" is the failure mode of every gate that scans. A walk that read nothing would pass
  //    every assertion above it and say nothing at all.
  assert.ok(judged > 40, `the walk read ${judged} files, so it is not reading the source it thinks it is`);
  assert.deepEqual(found, [], "this sentence stopped being true when `nmts extend` landed");
});

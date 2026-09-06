// `nmts extend` — what the wallet holds against what the extension costs, before anything is
// agreed to (`extend-budget.ts`).
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. A shortfall discovered after the signature costs the chain
//    fee for a transaction that bought nothing; a shortfall refused only after the agreement teaches
//    a person to grant signing in order to read a balance; and an unread balance drawn as zero
//    refuses a purchase the wallet can afford. The fee is a measured number or an honest "could
//    not be measured" — never a plausible figure.

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
} from "./fake-extend.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const opts = (
  out: { write: (line: string) => void },
  extra: Partial<Parameters<typeof extend>[1]> = {},
): Parameters<typeof extend>[1] => extendOpts(drive, out, extra);

test("⛔ a wallet short of the price is refused with both numbers, before the agreement and before any signature", async () => {
  // ⛔ NO `wallet` GRANT IN THIS SANDBOX — so a refusal here with exit 4 (not 5, "waiting on a
  //    person") proves the shortfall was found before the agreement was asked for.
  await withSandbox(drive, "extend-short-wal", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("a wallet known to be short reached the signer");
    const chain = fakeChain({ wallet: { wal: 1n } });
    const failure = await refusal(
      extend("photos/a.jpg", opts(collect(), { epochs: 2, readChain: () => chain, sign })),
    );
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /holds 0\.000000001 WAL/);
    assert.match(failure.message, /costs [0-9.]+ WAL/);
    assert.match(String(failure.nextStep), /Nothing was signed and nothing was charged/);
    assert.match(String(failure.nextStep), /Send WAL to 0x[0-9a-f]+/);
    assert.equal(sign.calls, 0);
    assert.equal(drive.extendRecorded.length, 0);
  });
});

test("⛔ a wallet short of SUI for the measured fee is refused the same way", async () => {
  await withSandbox(drive, "extend-short-sui", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("a wallet with no gas reached the signer");
    const chain = fakeChain({ wallet: { sui: 1n } });
    const failure = await refusal(
      extend("photos/a.jpg", opts(collect(), { epochs: 2, readChain: () => chain, sign })),
    );
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /holds 0\.000000001 SUI/);
    assert.match(failure.message, /fee .* about 0\.003 SUI/);
    assert.match(String(failure.nextStep), /Send SUI to 0x/);
    assert.equal(sign.calls, 0);
  });
});

test("⛔ a balance that could not be read is said as unread, never as zero, and does not stop the purchase", async () => {
  await withWalletAgreed(drive, "extend-unread", async (code) => {
    await servePhoto(drive, code);
    const sign = recordingSigner();
    const chain = fakeChain({ wallet: { wal: null }, gas: null });
    const out = collect();
    assert.equal(await extend("photos/a.jpg", opts(out, { epochs: 2, readChain: () => chain, sign })), 0);
    const text = out.lines.join("\n");
    assert.match(text, /WAL not read/);
    assert.match(text, /could not be read — WAL: the fake chain was told not to answer/);
    assert.match(text, /chain fee \(SUI\) could not be measured/);
    assert.doesNotMatch(text, /holds 0 WAL/);
    assert.equal(sign.asked.length, 1, "an unread balance stopped a purchase the wallet may well afford");
  });
});

test("--dry-run says the fee and the wallet in words and in JSON, and a shortfall as a warning", async () => {
  await withSandbox(drive, "extend-dry-budget", async (code) => {
    await servePhoto(drive, code);
    const sign = refuseToSign("--dry-run reached the signer");
    const out = collect();
    const chain = fakeChain({ wallet: { wal: 1n } });
    assert.equal(
      await extend("photos/a.jpg", opts(out, { epochs: 2, dryRun: true, readChain: () => chain, sign })),
      0,
    );
    const text = out.lines.join("\n");
    assert.match(text, /Chain fee about 0\.003 SUI, measured by a dry run/);
    assert.match(text, /Wallet 0x[0-9a-f]+ holds 0\.000000001 WAL and 1 SUI/);
    assert.match(text, /⚠ The wallet holds 0\.000000001 WAL .* it would be refused/);
    assert.match(text, /Nothing was signed and nothing was charged/);

    const json = collect();
    assert.equal(
      await extend("photos/a.jpg", opts(json, { epochs: 2, dryRun: true, json: true, sign })),
      0,
    );
    const parsed: unknown = JSON.parse(json.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    const at = (name: string): unknown => Reflect.get(parsed, name);
    assert.equal(at("feeMist"), "3000000", "base units are a string, so a program cannot round them");
    assert.equal(at("feeSui"), "0.003");
    assert.equal(at("walletSui"), "1");
    assert.match(String(at("wallet")), /^0x[0-9a-f]{64}$/);
    assert.equal(at("signed"), false);
  });
});

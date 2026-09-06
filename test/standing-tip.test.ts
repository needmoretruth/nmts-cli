// The standing tip — the share of a storage payment that goes to the developer after every wallet
// payment, without a question, because the person said so once.
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. It spends somebody's money with nobody watching, so the two
//    conditions that hold it back are asserted separately (a share above 0, and the gift terms
//    agreed to), the AMOUNT is asserted against arithmetic written out here rather than read back
//    out of the code under test, and a failure to send is asserted to leave the payment alone
//    rather than to throw — a gift that failed must never fail the storage purchase.
//
// ⚠ WHAT THEY DO NOT PROVE. No transaction is built or executed. Whether the chain accepts the
//   transfer cannot be known without spending real WAL.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { DonationConfig } from "../src/commands/wallet-donate.ts";
import { standingTipAfter, THANKS_EN, THANKS_KO } from "../src/standing-tip.ts";
import { walCoinType } from "../src/wallet.ts";
import type { SignTransfer } from "../src/wallet-sign.ts";
import { collect } from "./fake-drive.ts";

/** The published address, shaped like a real one so nothing refuses it early. */
const DEV = `0x${"d".repeat(64)}`;
const DIGEST = "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz";
const AGREED = Date.UTC(2026, 8, 6);

/** Gifts in WAL are open. A read, never a network call: no test here may reach the site. */
const giftsOpen = async (): Promise<DonationConfig> => ({ devAddress: DEV, sendEnabled: true, walEnabled: true });

type Shape = Parameters<SignTransfer>[0]["shape"];

/** A signer that answers a digest and remembers every shape it was handed. */
function recordingTransfer(): SignTransfer & { asked: Shape[] } {
  const asked: Shape[] = [];
  const sign = async (input: Parameters<SignTransfer>[0]): Promise<string> => {
    asked.push(input.shape);
    return DIGEST;
  };
  sign.asked = asked;
  return sign;
}

/** A signer that fails the test by being called at all. */
function refuseToSign(what: string): SignTransfer & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error(what);
  };
  sign.calls = 0;
  return sign;
}

test("⛔ nothing is sent until BOTH are true: a share above 0, and the gift terms agreed to", async () => {
  for (const settings of [undefined, {}, { tipTenths: 25 }, { tipConsentAt: AGREED }, { tipTenths: 0, tipConsentAt: AGREED }]) {
    const out = collect();
    const sign = refuseToSign("a gift went out for an account that never asked for one");
    const answer = await standingTipAfter({
      server: "http://127.0.0.1:1",
      network: "testnet",
      code: "not-a-code",
      settings,
      paidWalFrost: 1_000_000n,
      say: out.write,
      readDonation: giftsOpen,
      sign,
    });
    assert.equal(answer, "none", `it acted on ${JSON.stringify(settings)}`);
    assert.equal(sign.calls, 0);
    assert.deepEqual(out.lines, [], "it said something about a gift nobody set");
  }
});

test("the share of what was just paid goes to the published address, and the thanks are said in both languages", async () => {
  const out = collect();
  const sign = recordingTransfer();
  const answer = await standingTipAfter({
    server: "http://127.0.0.1:1",
    network: "testnet",
    code: "not-a-code",
    settings: { tipTenths: 25, tipConsentAt: AGREED },
    // ⛔ THE AMOUNT IS WRITTEN OUT, not recomputed here: 2.5 % of 1,000,000 base units is 25,000,
    //    and rounding it the other way would sign for one base unit more than the person chose.
    paidWalFrost: 1_000_000n,
    say: out.write,
    readDonation: giftsOpen,
    sign,
  });
  assert.equal(answer, "sent");
  assert.deepEqual(sign.asked, [
    { coin: "WAL", amountBaseUnits: 25_000n, destination: DEV, walType: walCoinType("testnet") },
  ]);
  const text = out.lines.join("\n");
  assert.match(text, /standing 2\.5 % gift — 0\.000025 WAL — went to the developer\./);
  assert.match(text, new RegExp(`Transaction ${DIGEST}`));
  assert.ok(text.includes(THANKS_EN), "the thanks were not said in English");
  assert.ok(text.includes(THANKS_KO), "the thanks were not said in Korean");
});

test("⛔ a gift that fails is said and answered, never thrown — the storage payment stands", async () => {
  const out = collect();
  const answer = await standingTipAfter({
    server: "http://127.0.0.1:1",
    network: "testnet",
    code: "not-a-code",
    settings: { tipTenths: 25, tipConsentAt: AGREED },
    paidWalFrost: 1_000_000n,
    say: out.write,
    readDonation: giftsOpen,
    sign: async () => {
      throw new Error("the wallet had nothing left");
    },
  });
  assert.equal(answer, "failed");
  const text = out.lines.join("\n");
  assert.match(text, /gift was not sent: the wallet had nothing left/);
  assert.match(text, /The storage payment above is unaffected\./);
});

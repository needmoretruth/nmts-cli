// `nmts wallet donate` — a gift needs --yes every
// time, says the four facts and the promise before signing, goes to the address the server
// publishes, and stands outside the wallet agreement and its ledger.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { GIFT_NOTICES, asDonationConfig, walletDonate, type DonationConfig } from "../src/commands/wallet-donate.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { THANKS_EN, THANKS_KO } from "../src/standing-tip.ts";
import { readWalletGrant } from "../src/wallet-grant.ts";
import type { SendReads, TransferShape } from "../src/wallet-send-chain.ts";
import type { SignTransfer } from "../src/wallet-sign.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function withAccount(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  process.env[CODE_ENV_VAR] = await generateCode();
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

const DEV = "0x" + "cd".repeat(32);
const OPEN: DonationConfig = { devAddress: DEV, sendEnabled: true, walEnabled: true };

function reads(): SendReads {
  return {
    async readWallet() {
      return { sui: { read: true, baseUnits: 1_000_000_000n }, wal: { read: true, baseUnits: 5_000_000_000n } };
    },
    async estimateFee() {
      return 2_000_000n;
    },
  };
}

function refuseToSign(): SignTransfer & { calls: number } {
  const sign = async (): Promise<string> => {
    sign.calls += 1;
    throw new Error("it signed");
  };
  sign.calls = 0;
  return sign;
}

function recordingSigner(): SignTransfer & { asked: TransferShape[] } {
  const asked: TransferShape[] = [];
  const sign = async (input: { shape: TransferShape }): Promise<string> => {
    asked.push(input.shape);
    return "3nJqYd2fRZ8m1s5vQ7wLpXk4TgB6uCa9HyEr2NdM8fPz";
  };
  sign.asked = asked;
  return sign;
}

async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

const FACTS: ReadonlyArray<[string, RegExp]> = [
  ["voluntary", /voluntary/i],
  ["nothing in return", /nothing[^.]*in return/i],
  ["non-refundable", /non-?refundable/i],
  ["cannot be undone", /cannot be undone/i],
  ["no record — the id is the only proof", /no record[\s\S]*only proof/i],
];

test("⛔ without --yes the facts are printed and nothing is signed; a closed card closes the tool too", async () => {
  await withAccount("wallet-donate-review", async () => {
    const out = collect();
    const sign = refuseToSign();
    const failure = await refusal(
      walletDonate(["WAL", "2"], { network: "testnet", write: out.write, readDonation: async () => OPEN, readChain: () => reads(), sign }),
    );
    assert.equal(failure.exitCode, 4);
    assert.match(String(failure.nextStep), /--yes/);
    const text = out.lines.join("\n");
    assert.match(text, /^Gift of 2 WAL to the developer$/m);
    assert.match(text, new RegExp(DEV));
    for (const [what, re] of FACTS) assert.match(text, re, `${what} is missing`);
    assert.equal(sign.calls, 0);
    for (const line of GIFT_NOTICES) assert.ok(line.length > 0);

    const closed = await refusal(
      walletDonate(["SUI", "0.1"], { network: "testnet", write: () => undefined, readDonation: async () => ({ ...OPEN, sendEnabled: false }), readChain: () => reads(), sign }),
    );
    assert.equal(closed.exitCode, 4);
    assert.match(closed.message, /not open right now/);
    const noWal = await refusal(
      walletDonate(["WAL", "1"], { network: "testnet", write: () => undefined, readDonation: async () => ({ ...OPEN, walEnabled: false }), readChain: () => reads(), sign }),
    );
    assert.match(noWal.message, /WAL are not open/);
    assert.equal(asDonationConfig({ devAddress: DEV, sendEnabled: "1" }).sendEnabled, false, "only a true is open");
  });
});

test("with --yes the gift goes to the published address, and the wallet agreement is neither needed nor charged", async () => {
  await withAccount("wallet-donate-signs", async () => {
    const sign = recordingSigner();
    const out = collect();
    assert.equal(
      await walletDonate(["sui", "0.25"], { network: "testnet", yes: true, write: out.write, readDonation: async () => OPEN, readChain: () => reads(), sign }),
      0,
    );
    assert.equal(sign.asked.length, 1);
    assert.equal(sign.asked[0]?.destination, DEV);
    assert.equal(sign.asked[0]?.amountBaseUnits, 250_000_000n);
    assert.match(out.lines.join("\n"), /Thank you — your gift was sent\. Transaction 3nJqYd2f/);
    assert.match(out.lines.join("\n"), /Keep that id/);
    assert.equal(readWalletGrant(), null, "a gift wrote a wallet agreement, or charged one");
  });
});

test("a gift that went is thanked in both languages, and told where a name can be listed", async () => {
  await withAccount("wallet-donate-thanks", async () => {
    const out = collect();
    assert.equal(
      await walletDonate(["WAL", "1"], {
        network: "testnet", yes: true, write: out.write,
        readDonation: async () => OPEN, readChain: () => reads(), sign: recordingSigner(),
      }),
      0,
    );
    const text = out.lines.join("\n");
    // ⛔ BOTH LINES, WHOLE. They are the owner's own words in the owner's own languages; a test
    //    that matched a fragment would pass while half a sentence was missing.
    assert.ok(text.includes(THANKS_EN), "the English thanks is missing");
    assert.ok(text.includes(THANKS_KO), "the Korean thanks is missing");
    assert.match(text, /To be listed by name on nmts\.me\/hall: nmts wallet hall --name <name>/);
  });
});

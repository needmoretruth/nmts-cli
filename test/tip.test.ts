// `nmts tip` — the standing share of every storage payment that goes to the developer as a gift.
//
// ⛔ THE SHARE IS ASSERTED THROUGH THE SEALED LIST, never through what the command said. It lives
//    in that blob or nowhere, and a settings field carried by neither direction of the codec is a
//    real defect this format has had: every save dropped it, on every device, silently. Setting it
//    and then reading it back through the blob the tool actually wrote is the only assertion that
//    could fail for that.
//
// ⛔ AND NOTHING HERE MAY SEND ANYTHING. This command writes a setting; the sending happens after a
//    payment (`standing-tip.test.ts`). No signer is supplied below, so a run that tried to spend
//    would reach a real one and fail loudly.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { tip, type TipOptions } from "../src/commands/tip.ts";
import { testConfigDir } from "../src/credentials.ts";
import { collect, entry, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { grantConsents } from "./helpers.ts";

const drive = await startFakeDrive();
after(() => drive.close());

/** The instant every run below measures against, so one run reports one moment. */
const AGREED = Date.UTC(2026, 8, 6);

const opts = (out: { write: (line: string) => void }, extra: Partial<TipOptions> = {}): TipOptions => ({
  server: drive.base,
  network: "testnet",
  write: out.write,
  now: AGREED,
  ...extra,
});

/** A sandbox where the gift terms — the `donate` unlock — have been agreed to on this machine. */
async function withGiftTermsAgreed(name: string, body: (code: string) => Promise<void>): Promise<void> {
  await withSandbox(drive, name, async (code) => {
    grantConsents(testConfigDir(name), "plain-env", "donate");
    await body(code);
  });
}

test("an account that never set a share is told nothing is sent, and how to set one", async () => {
  await withSandbox(drive, "tip-read-off", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    assert.equal(await tip(undefined, opts(out)), 0);
    const text = out.lines.join("\n");
    assert.match(text, /No standing gift: 0 % of each storage payment goes to the developer\./);
    assert.match(text, /`nmts tip off`/);
    assert.equal(drive.written.length, 0, "reading the setting wrote the list");
  });
});

test("2.5 % goes into the sealed list with the instant the terms were agreed to, and reads back from there", async () => {
  await withGiftTermsAgreed("tip-set", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const set = collect();
    assert.equal(await tip("2.5", opts(set)), 0);
    assert.equal(drive.written.length, 1, `it wrote the list ${drive.written.length} times`);
    assert.match(set.lines.join("\n"), /now sends 2\.5 % of what it paid to the developer/);

    // ⛔ Read back through the blob the tool actually sent: 25 tenths and the agreement's instant.
    const read = collect();
    assert.equal(await tip(undefined, opts(read)), 0);
    const text = read.lines.join("\n");
    assert.match(text, /Every storage payment sends 2\.5 % of what it paid/);
    assert.match(text, /The gift terms were agreed to on 2026-09-06\./);
  });
});

test("⛔ a share above 10 % is confirmed in words, and `n` writes nothing", async () => {
  await withGiftTermsAgreed("tip-high-no", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const asked: string[] = [];
    const out = collect();
    const answer = await tip(
      "25",
      opts(out, {
        readLine: async (question: string) => {
          asked.push(question);
          return "n";
        },
      }),
    );
    assert.equal(answer, 1, "refusing the confirmation must not answer success");
    assert.match(asked.join("\n"), /Send 25 % of EVERY storage payment to the developer, permanently/);
    assert.deepEqual(out.lines, ["Nothing changed."]);
    assert.equal(drive.written.length, 0, "it wrote a share nobody confirmed");
  });
});

test("--yes answers that confirmation, and the share is written", async () => {
  await withGiftTermsAgreed("tip-high-yes", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const out = collect();
    const answer = await tip(
      "25",
      opts(out, {
        yes: true,
        readLine: async () => {
          throw new Error("--yes still asked the question");
        },
      }),
    );
    assert.equal(answer, 0);
    assert.equal(drive.written.length, 1);
    assert.match(out.lines.join("\n"), /now sends 25 % of what it paid/);
  });
});

test("`off` puts the share back to nothing", async () => {
  await withGiftTermsAgreed("tip-off", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    assert.equal(await tip("2.5", opts(collect())), 0);
    const out = collect();
    assert.equal(await tip("off", opts(out)), 0);
    assert.match(out.lines.join("\n"), /Standing gift set to 0 %: nothing more is sent after a payment\./);

    const read = collect();
    assert.equal(await tip(undefined, opts(read, { json: true })), 0);
    const parsed: unknown = JSON.parse(read.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(parsed, "tipTenths"), 0);
  });
});

test("--json says the share as tenths and as a percent, and when the terms were agreed to", async () => {
  await withGiftTermsAgreed("tip-json", async (code) => {
    await drive.serve(code, [entry({ id: "a", name: "a.txt" })]);
    const set = collect();
    assert.equal(await tip("2.5", opts(set, { json: true })), 0);
    const written: unknown = JSON.parse(set.lines.join(""));
    assert.ok(typeof written === "object" && written !== null);
    assert.deepEqual(
      { percent: Reflect.get(written, "tipPercent"), tenths: Reflect.get(written, "tipTenths"), changed: Reflect.get(written, "changed") },
      { percent: 2.5, tenths: 25, changed: true },
    );

    const read = collect();
    assert.equal(await tip(undefined, opts(read, { json: true })), 0);
    const parsed: unknown = JSON.parse(read.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.deepEqual(
      { percent: Reflect.get(parsed, "tipPercent"), tenths: Reflect.get(parsed, "tipTenths"), agreedAt: Reflect.get(parsed, "agreedAt") },
      { percent: 2.5, tenths: 25, agreedAt: new Date(AGREED).toISOString() },
    );
  });
});

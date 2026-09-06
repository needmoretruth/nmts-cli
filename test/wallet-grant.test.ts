// The wallet agreement with a scope, an expiry and ceilings (`wallet-grant.ts`).
//
// ⛔ WHAT THESE ARE WRITTEN TO CATCH. An agent in `mode auto` giving itself an open-ended wallet
//    grant; a grant that outlives the month it was given for; an older bare-date record read as
//    "everything, forever"; a ceiling that is checked after the signature instead of before.

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { unlock } from "../src/commands/unlock.ts";
import { NmtsError } from "../src/errors.ts";
import {
  MAX_GRANT_DAYS,
  parseCoinAmount,
  parseWalletGrant,
  readWalletGrant,
  recordWalletSpend,
  requireWalletGrant,
  walletGrantState,
  writeWalletGrant,
} from "../src/wallet-grant.ts";

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "nmts-wallet-grant-"));
  process.env["NMTS_CONFIG_DIR"] = dir;
  return dir;
}

const AT = new Date("2026-09-05T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function refusal(run: () => unknown): NmtsError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof NmtsError, `not a refusal: ${String(error)}`);
    return error;
  }
  assert.fail("it did not refuse");
}

async function refusalAsync(run: () => Promise<unknown>): Promise<NmtsError> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof NmtsError, `not a refusal: ${String(error)}`);
    return error;
  }
  assert.fail("it did not refuse");
}

test("⛔ a wallet agreement needs an expiry, and it is at most 30 days away", () => {
  const none = refusal(() => parseWalletGrant({}, AT, "t"));
  assert.equal(none.exitCode, 2);
  assert.match(String(none.nextStep), /--days 7/);
  const long = refusal(() => parseWalletGrant({ days: "31" }, AT, "t"));
  assert.match(long.message, new RegExp(`at most ${MAX_GRANT_DAYS} days`));
  const past = refusal(() => parseWalletGrant({ until: "2026-09-01" }, AT, "t"));
  assert.match(past.message, /already in the past/);
  const ok = parseWalletGrant({ days: "7" }, AT, "1.2.3");
  assert.equal(ok.expiresAt, new Date(AT.getTime() + 7 * DAY).toISOString());
  assert.equal(ok.scope, "storage", "storage is the default scope");
  assert.equal(ok.capWalFrost, null);
  const dated = parseWalletGrant({ until: "2026-09-30T00:00:00Z", scope: "all", capWal: "12.5", capSui: "0.25" }, AT, "t");
  assert.equal(dated.scope, "all");
  assert.equal(dated.capWalFrost, "12500000000");
  assert.equal(dated.capSuiMist, "250000000");
  assert.equal(parseCoinAmount("0.000000001", "x"), 1n);
  assert.match(refusal(() => parseCoinAmount("1.0000000001", "--cap-wal")).message, /number of coins/);
  assert.match(refusal(() => parseWalletGrant({ days: "3", scope: "everything" }, AT, "t")).message, /--scope must be/);
});

test("⛔ nothing is agreed to until it is, an older bare-date record counts as nothing, and a run-out grant says when", () => {
  const dir = isolate();
  try {
    const none = refusal(() => requireWalletGrant("extend", { walFrost: 1n, suiMist: 1n }, AT));
    assert.equal(none.exitCode, 5);
    assert.match(String(none.nextStep), /unlock wallet --days 7/);
    assert.match(String(none.nextStep), /Do not run the unlock command yourself/);

    // What versions before this one wrote for the same key.
    writeFileSync(join(dir, "consent.json"), JSON.stringify({ wallet: { grantedAt: "2026-08-01T00:00:00.000Z", byVersion: "0.20.0" } }));
    assert.equal(readWalletGrant(), null);
    assert.equal(walletGrantState(readWalletGrant(), AT), "none");
    assert.equal(refusal(() => requireWalletGrant("extend", { walFrost: 1n, suiMist: 1n }, AT)).exitCode, 5);

    writeWalletGrant(parseWalletGrant({ days: "2" }, AT, "t"));
    assert.equal(walletGrantState(readWalletGrant(), AT), "active");
    const later = new Date(AT.getTime() + 3 * DAY);
    assert.equal(walletGrantState(readWalletGrant(), later), "expired");
    const out = refusal(() => requireWalletGrant("extend", { walFrost: 1n, suiMist: 1n }, later));
    assert.equal(out.exitCode, 5);
    assert.match(out.message, /ran out on 2026-09-07T12:00:00\.000Z/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ scope storage does not reach exchanging or sending, and a gift is in no scope at all", () => {
  const dir = isolate();
  try {
    writeWalletGrant(parseWalletGrant({ days: "7" }, AT, "t"));
    assert.equal(requireWalletGrant("extend", { walFrost: 1n, suiMist: 1n }, AT).scope, "storage");
    assert.equal(requireWalletGrant("seal", { walFrost: 1n, suiMist: 1n }, AT).scope, "storage");
    const send = refusal(() => requireWalletGrant("send", { walFrost: 1n, suiMist: 1n }, AT));
    assert.equal(send.exitCode, 5);
    assert.match(send.message, /covers storage only/);
    assert.match(String(send.nextStep), /--scope all/);
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, AT, "t"));
    assert.equal(requireWalletGrant("send", { walFrost: 1n, suiMist: 1n }, AT).scope, "all");
    assert.equal(requireWalletGrant("exchange", { walFrost: 1n, suiMist: 1n }, AT).scope, "all");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a ceiling is held against BEFORE the signature, counts what was signed, and says the two numbers", () => {
  const dir = isolate();
  try {
    writeWalletGrant(parseWalletGrant({ days: "7", capWal: "10", capSui: "0.01" }, AT, "t"));
    requireWalletGrant("extend", { walFrost: 6_000_000_000n, suiMist: 3_000_000n }, AT);
    recordWalletSpend({ walFrost: 6_000_000_000n, suiMist: 3_000_000n });
    assert.equal(readWalletGrant()?.spentWalFrost, "6000000000");
    // 6 signed away + 5 asked = 11 > 10.
    const over = refusal(() => requireWalletGrant("extend", { walFrost: 5_000_000_000n, suiMist: 1n }, AT));
    assert.equal(over.exitCode, 5);
    assert.match(over.message, /sign away 5 WAL .* 4 WAL left/);
    assert.match(String(over.nextStep), /Ceiling 10 WAL, of which 6 WAL is already signed away/);
    // Within the WAL room but past the SUI room.
    const gas = refusal(() => requireWalletGrant("extend", { walFrost: 1n, suiMist: 8_000_000n }, AT));
    assert.match(gas.message, /0\.008 SUI in fees .* 0\.007 SUI left/);
    // A grant with no ceiling never refuses on amount.
    writeWalletGrant(parseWalletGrant({ days: "7" }, AT, "t"));
    requireWalletGrant("extend", { walFrost: 10n ** 18n, suiMist: 10n ** 18n }, AT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`unlock wallet` writes the three things and `unlock` lists them", async () => {
  const dir = isolate();
  try {
    const lines: string[] = [];
    const write = (l: string): number => lines.push(l);
    assert.equal((await refusalAsync(() => unlock("unlock", "wallet", { write, now: () => AT, readLine: async () => "y" }))).exitCode, 2, "no expiry, no grant");
    assert.equal(await unlock("unlock", "wallet", { write, now: () => AT, days: "7", scope: "all", capWal: "3", readLine: async () => "y" }), 0);
    assert.match(lines.join("\n"), /unlocked: wallet — scope all, until 2026-09-12T12:00:00\.000Z/);
    assert.match(lines.join("\n"), /ceiling 3 WAL/);
    lines.length = 0;
    assert.equal(await unlock(undefined, undefined, { write, now: () => AT }), 0);
    const text = lines.join("\n");
    assert.match(text, /^ {2}unlocked +wallet$/m);
    assert.match(text, /scope all · unlocked 2026-09-05T12:00:00\.000Z · until 2026-09-12T12:00:00\.000Z/);
    assert.match(text, /ceiling 3 WAL · signed away so far 0 WAL, 0 SUI in fees/);
    lines.length = 0;
    assert.equal(await unlock(undefined, undefined, { write, now: () => AT, json: true }), 0);
    const parsed: unknown = JSON.parse(lines.join(""));
    assert.ok(Array.isArray(parsed));
    const wallet: unknown = parsed.find((r: unknown) => typeof r === "object" && r !== null && Reflect.get(r, "key") === "wallet");
    assert.ok(typeof wallet === "object" && wallet !== null);
    assert.equal(Reflect.get(wallet, "state"), "active");
    assert.equal(Reflect.get(wallet, "capWalFrost"), "3000000000");
    lines.length = 0;
    assert.equal(await unlock(undefined, undefined, { write, now: () => new Date(AT.getTime() + 8 * DAY) }), 0);
    assert.match(lines.join("\n"), /^ {2}ran out +wallet$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

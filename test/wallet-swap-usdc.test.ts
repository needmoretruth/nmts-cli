// `nmts wallet swap` with three coins — USDC's six decimals in the review and the market
// check, the coin-type rule, the agreement's ceiling, and the route of a DeepBook WAL↔SUI quote
// reaching the signature. ⛔ No chain, no wallet, no money: every read and the signature go through seams.

import { strict as assert } from "node:assert";

import { bcs } from "@mysten/sui/bcs";
import { fromBase64 } from "@mysten/sui/utils";
import { test } from "node:test";

import { walletSwap } from "../src/commands/wallet-swap.ts";
import { minOutFromQuote, SLIPPAGE_BPS_DEFAULT } from "../src/shared/lib/wallet/swap-rules.ts";
import {
  BLUEFIN_SUI_USDC_POOLS,
  DEEPBOOK_PACKAGE_IDS,
  DEEPBOOK_SUI_USDC_POOLS,
  DEEPBOOK_WAL_USDC_POOLS,
} from "../src/shared/lib/wallet/venue-ids.ts";
import { parseWalletGrant, readWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import { swapTransaction, type SwapReads, type SwapShape } from "../src/wallet-swap-chain.ts";
import {
  AT,
  BINDING,
  collect,
  FIRST_WALLET,
  reads,
  recordingSigner,
  refusal,
  refuseToSign,
  withAccount,
} from "./wallet-swap-fixtures.ts";

// ── Three coins: SUI, WAL and Circle's native USDC, six directions ──────────────────
//
// ⛔ USDC keeps SIX decimals. Read with nine, "5" would be 0.005 USDC and a quote of 4 SUI would sit
//    a thousandfold from the market. These tests hold the review, the market check, the coin-type
//    rule (a coin that is only CALLED USDC is refused), the agreement's ceiling, and the route a
//    DeepBook WAL↔SUI quote came from travelling all the way to the signature.

const CIRCLE_USDC = "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
/** SUI at $1.25 and USDC at $1.00: 0.8 SUI per USDC, 1.25 USDC per SUI. */
const USD_PRICES = async () => ({ suiUsd: 1.25, walUsd: 0.036, usdcUsd: 1.0 });

/** Quotes at the market: 0.8 SUI per USDC (in each coin's own base units), 1.25 USDC per SUI. */
function usdcReads(): SwapReads & { estimated: SwapShape[] } {
  const base = reads();
  return {
    ...base,
    async quote(venue, direction, amountInUnits) {
      const outUnits =
        direction === "USDC_TO_SUI" ? amountInUnits * 800n // 1e6 USDC units → 8e8 MIST
        : direction === "SUI_TO_USDC" ? (amountInUnits * 125n) / 100_000n // 1e9 MIST → 1.25e6
        : amountInUnits;
      return { venue, outUnits, feeRateBps: 17.5, leftoverInUnits: 0n, route: "direct", leftoverMidUnits: 0n };
    },
  };
}

test("USDC → SUI: the review reads USDC in six decimals, the market check uses the USDC price, max is the USDC held", async () => {
  await withAccount("wallet-swap-usdc", async () => {
    const out = collect();
    const chain = usdcReads();
    const failure = await refusal(walletSwap(["USDC", "5"], { ...FIRST_WALLET, network: "mainnet", to: "SUI", venue: "bluefin", write: out.write, readChain: () => chain, readPrices: USD_PRICES, sign: refuseToSign() }));
    assert.equal(failure.exitCode, 4);
    assert.match(failure.message, /needs --yes/);
    const text = out.lines.join("\n");
    assert.match(text, /^Swapping 5 USDC for SUI on Bluefin$/m);
    assert.match(text, /Quoted {4}4 SUI/);
    assert.match(text, /At least {2}3\.98 SUI/);
    assert.match(text, /Market {4}0% from the site's reference price \(1 USDC ≈ 0\.8000 SUI\)/);
    assert.match(text, /and 7 USDC$/m);
    assert.equal(chain.estimated[0]?.direction, "USDC_TO_SUI");
    assert.equal(chain.estimated[0]?.amountInUnits, 5_000_000n);

    const max = collect();
    await refusal(walletSwap(["USDC", "max"], { ...FIRST_WALLET, network: "mainnet", to: "SUI", venue: "bluefin", write: max.write, readChain: () => usdcReads(), readPrices: USD_PRICES, sign: refuseToSign() }));
    assert.match(max.lines.join("\n"), /^Swapping 12 USDC for SUI/m);
    // Seven decimals is finer than USDC keeps.
    const fine = await refusal(walletSwap(["USDC", "1.1234567"], { ...FIRST_WALLET, network: "mainnet", to: "SUI", venue: "bluefin", write: () => undefined, readChain: () => usdcReads(), sign: refuseToSign() }));
    assert.equal(fine.exitCode, 2);
    assert.match(fine.message, /at most 6 decimals for USDC/);
    // More than is held.
    assert.equal((await refusal(walletSwap(["USDC", "13"], { ...FIRST_WALLET, network: "mainnet", to: "SUI", venue: "bluefin", write: () => undefined, readChain: () => usdcReads(), sign: refuseToSign() }))).exitCode, 4);
  });
});

test("⛔ USDC must say --to, a coin only CALLED USDC is refused, and the exact Circle type is accepted", async () => {
  await withAccount("wallet-swap-usdc-type", async () => {
    const sign = refuseToSign();
    const quiet = { ...FIRST_WALLET, network: "mainnet", venue: "bluefin", write: () => undefined, readChain: () => usdcReads(), readPrices: USD_PRICES, sign };
    const noTo = await refusal(walletSwap(["USDC", "1"], quiet));
    assert.equal(noTo.exitCode, 2);
    assert.match(noTo.message, /--to SUI or --to WAL/);
    const fake = await refusal(walletSwap(["0x" + "ee".repeat(32) + "::usdc::USDC", "1"], { ...quiet, to: "SUI" }));
    assert.equal(fake.exitCode, 2);
    assert.match(fake.message, /is not SUI, WAL or Circle's native USDC/);
    assert.ok(String(fake.nextStep).includes(CIRCLE_USDC));
    const fakeOut = await refusal(walletSwap(["SUI", "1"], { ...quiet, to: "0x" + "ee".repeat(32) + "::usdc::USDC" }));
    assert.equal(fakeOut.exitCode, 2);
    const out = collect();
    const real = await refusal(walletSwap([CIRCLE_USDC, "5"], { ...quiet, to: "SUI", write: out.write }));
    assert.match(real.message, /needs --yes/);
    assert.match(out.lines.join("\n"), /^Swapping 5 USDC for SUI/m);
    assert.equal((await refusal(walletSwap(["USDC", "1"], { ...quiet, to: "USDC" }))).exitCode, 2);
    assert.equal(sign.calls, 0);
  });
});

test("⛔ a USDC spend is not signed uncounted under an agreement with a ceiling; without one it signs", async () => {
  await withAccount("wallet-swap-usdc-cap", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all", capSui: "1" }, new Date(AT), "t"));
    const base = { ...FIRST_WALLET, network: "mainnet", to: "SUI", venue: "bluefin", yes: true, write: () => undefined, readChain: () => usdcReads(), readPrices: USD_PRICES, now: AT };
    const capped = await refusal(walletSwap(["USDC", "5"], { ...base, sign: refuseToSign() }));
    assert.equal(capped.exitCode, 5);
    assert.match(capped.message, /ceilings count SUI and WAL only/);
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, new Date(AT), "t"));
    const sign = recordingSigner();
    assert.equal(await walletSwap(["USDC", "5"], { ...base, sign }), 0);
    assert.equal(sign.asked[0]?.direction, "USDC_TO_SUI");
    assert.equal(sign.asked[0]?.minOutUnits, minOutFromQuote(4_000_000_000n, SLIPPAGE_BPS_DEFAULT));
    // Only the fee is SUI spent; no WAL.
    assert.equal(readWalletGrant()?.spentWalFrost, "0");
    assert.equal(readWalletGrant()?.spentSuiMist, "2100000");
  });
});

test("DeepBook WAL → SUI through USDC: the review says so, and the route reaches the fee dry run and the signature", async () => {
  await withAccount("wallet-swap-via-usdc", async () => {
    writeWalletGrant(parseWalletGrant({ days: "7", scope: "all" }, new Date(AT), "t"));
    const base = reads();
    const chain: SwapReads & { estimated: SwapShape[] } = {
      ...base,
      async quote(venue, _direction, amountInUnits) {
        // 1,000 WAL → 29 SUI through USDC (2026-09-28 measurement), with 0.056697 USDC left over.
        return { venue, outUnits: (amountInUnits * 29n) / 1000n, feeRateBps: 4, leftoverInUnits: 0n, route: "viaUsdc", leftoverMidUnits: 56_697n };
      },
    };
    const sign = recordingSigner();
    const out = collect();
    assert.equal(
      await walletSwap(["WAL", "100"], { ...FIRST_WALLET, network: "mainnet", venue: "deepbook", yes: true, write: out.write, readChain: () => chain, readPrices: async () => ({ suiUsd: 1.25, walUsd: 0.03625, usdcUsd: 1 }), sign, now: AT }),
      0,
    );
    const text = out.lines.join("\n");
    assert.match(text, /Route {5}WAL → USDC → SUI, two pools in one transaction/);
    assert.match(text, /0\.056697 USDC would come back unused/);
    assert.equal(chain.estimated[0]?.route, "viaUsdc");
    assert.equal(sign.asked[0]?.route, "viaUsdc");
  });
});

test("the swap transaction: through USDC it chains two DeepBook pools, and no address but the signer's appears", async () => {
  const sender = "0x" + "5a".repeat(32);
  const via = swapTransaction({ network: "mainnet", sender, venue: "deepbook", direction: "WAL_TO_SUI", amountInUnits: 1_000_000_000_000n, minOutUnits: 28_855_000_000n, route: "viaUsdc" }).getData();
  const calls = via.commands.flatMap((c) => (c.$kind === "MoveCall" ? [c.MoveCall] : []));
  assert.deepEqual(calls.map((c) => c.function), ["zero", "swap_exact_base_for_quote", "swap_exact_quote_for_base"]);
  const objectOf = (arg: { $kind: string } | undefined): string => {
    if (arg === undefined || arg.$kind !== "Input" || !("Input" in arg) || typeof arg.Input !== "number") throw new Error("not an input");
    const input = via.inputs[arg.Input];
    if (input?.$kind !== "UnresolvedObject") throw new Error("not an object");
    return input.UnresolvedObject.objectId;
  };
  assert.equal(objectOf(calls[1]?.arguments[0]), DEEPBOOK_WAL_USDC_POOLS.mainnet);
  assert.equal(objectOf(calls[2]?.arguments[0]), DEEPBOOK_SUI_USDC_POOLS.mainnet);
  assert.equal(calls[1]?.typeArguments[1], CIRCLE_USDC);
  const packages = [DEEPBOOK_PACKAGE_IDS.mainnet, "0x0000000000000000000000000000000000000000000000000000000000000002"];
  for (const c of calls) assert.ok(packages.includes(c.package), `a foreign package: ${c.package}`);

  for (const data of [
    via,
    swapTransaction({ network: "mainnet", sender, venue: "deepbook", direction: "USDC_TO_WAL", amountInUnits: 5_000_000n, minOutUnits: 1n }).getData(),
    swapTransaction({ network: "mainnet", sender, venue: "bluefin", direction: "SUI_TO_USDC", amountInUnits: 5_000_000_000n, minOutUnits: 1n, bluefin: { ...BINDING, pools: { ...BINDING.pools, SUI_USDC: BLUEFIN_SUI_USDC_POOLS.mainnet } } }).getData(),
  ]) {
    for (const input of data.inputs) {
      if (input.$kind === "Pure") {
        const bytes = fromBase64(input.Pure.bytes);
        if (bytes.length === 32) assert.equal(bcs.Address.parse(bytes), sender, "an address other than the signer's");
      }
    }
  }
});

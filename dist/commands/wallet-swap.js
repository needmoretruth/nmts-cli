// `nmts wallet swap <SUI|WAL|USDC> <amount|max> [--to <coin>]` — turn one coin into another, from the
// wallet this NMTS key derives, on the venue the person names. ⛔ SIGNS AND SPENDS.
//
// ⛔ THREE COINS, SIX DIRECTIONS. SUI, WAL and Circle's native USDC, any into either of the other two.
//    Without --to, SUI goes to WAL and WAL to SUI (the two-coin behaviour, kept); USDC must say --to.
//    A coin may also be named by its full coin type, and then only the EXACT type counts — a coin
//    whose symbol is "USDC" from another package is refused, never swapped.
//
// ⛔ THE ORDER IS THE SAFETY. ① the balances the trade touches are READ, and an unread one stops the
//    run ② the amount and the slippage are judged by the browser's own rules (`shared/lib/wallet/
//    swap-rules.ts`, copied byte-for-byte) ③ the venue's quote is read from the chain — on mainnet
//    BOTH venues when none was named, printed side by side, and the run stops there: neither is a
//    default and nobody recommends one ④ the exact swap is dry-run for its fee ⑤ the quote is compared
//    with the site's reference price when one can be read, and said to be uncompared when none can
//    ⑥ the review is printed ⑦ anything outside the ordinary bands — slippage, fee cap, market
//    distance — is refused; only a person, in mode off, may say `--accept-extremes` ⑧ without `--yes`
//    that is the end ⑨ the wallet agreement is held against the amount and the fee, scope `all`
//    ⑩ only then the signature.
//
// ⛔ NOT ON THE MCP SURFACE. A model can ask a person to run this; it cannot run it through a tool call.
import { request } from "../api.js";
import { currentMode } from "../autonomy.js";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { explorerTxUrl } from "../shared/lib/wallet/activity.js";
import { clampGasBudgetMist, parseTokenAmountToBaseUnits, SUI_GAS_RESERVE_MIST } from "../shared/lib/wallet/send-rules.js";
import { clampSlippageBps, COIN_DECIMALS, directionOf, impliedRate, marketRate, maxSwappableSuiMist, minOutFromQuote, priceDeviationBps, SLIPPAGE_BPS_DEFAULT, SLIPPAGE_BPS_MAX, SLIPPAGE_BPS_MIN, swapExtremes, } from "../shared/lib/wallet/swap-rules.js";
import { coinAmount, walletAddress } from "../wallet.js";
import { payingWalletIndex } from "../wallet-pay-index.js";
import { recordWalletSpend, requireWalletGrant } from "../wallet-grant.js";
import { railsFor } from "../wallet-swap-chain.js";
import { amountOf, asMarketPrices, coinWordOf, EXTREME_WORDS, pct, quoteLine, resolveCoin, USAGE, venueName, } from "../wallet-swap-words.js";
export { asMarketPrices } from "../wallet-swap-words.js";
export async function walletSwap(operands, options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const [coinRaw, amountRaw] = operands;
    const inWord = coinWordOf(coinRaw, "goes in");
    const toWord = options.to === undefined ? null : coinWordOf(options.to, "comes out");
    if (amountRaw === undefined) {
        throw new NmtsError("Say how much.", { exitCode: 2, nextStep: `${USAGE} — "max" swaps everything that can be swapped.` });
    }
    const resolved = await requireAccountCode();
    // ⛔ WHICH WALLET SWAPS, FIRST — the coins that are read, the quote that is priced, the address
    //    the review names and the key that signs are all this one wallet's.
    const wallet = await payingWalletIndex(options);
    const address = await walletAddress(resolved.code, wallet);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    // The direction: the coin named, into --to; without --to, SUI↔WAL as before, and USDC must say.
    const coinIn = resolveCoin(inWord, network);
    let coinOut;
    if (toWord !== null) {
        coinOut = resolveCoin(toWord, network);
    }
    else if (coinIn === "USDC") {
        throw new NmtsError("Say which coin USDC becomes: --to SUI or --to WAL.", { exitCode: 2, nextStep: USAGE });
    }
    else {
        coinOut = coinIn === "SUI" ? "WAL" : "SUI";
    }
    const direction = directionOf(coinIn, coinOut);
    if (direction === null) {
        throw new NmtsError(`${coinIn} cannot be swapped for itself.`, { exitCode: 2, nextStep: `Say --to one of the other two coins.` });
    }
    const rails = railsFor(network);
    const reads = await (options.readChain ?? (async (net) => (await import("../wallet-swap-chain.js")).swapReads(net)))(network);
    // ① The balances — read, and refused as unread rather than treated as zero. USDC is read only when
    //    the trade touches it, so an unreadable USDC never stops a SUI↔WAL swap.
    const purse = await reads.readWallet(address);
    const usdcRead = coinIn === "USDC" || coinOut === "USDC" ? await reads.readUsdc(address) : null;
    if (!purse.sui.read || !purse.wal.read || (usdcRead !== null && !usdcRead.read)) {
        const which = [
            !purse.sui.read ? `SUI: ${purse.sui.why}` : null,
            !purse.wal.read ? `WAL: ${purse.wal.why}` : null,
            usdcRead !== null && !usdcRead.read ? `USDC: ${usdcRead.why}` : null,
        ].filter((w) => w !== null);
        throw new NmtsError("A balance could not be read, so this tool cannot tell what can be swapped.", {
            exitCode: 1,
            nextStep: `Nothing was signed. That is not an empty wallet — ${which.join("; ")}.`,
        });
    }
    const held = {
        SUI: purse.sui.baseUnits,
        WAL: purse.wal.baseUnits,
        USDC: usdcRead !== null && usdcRead.read ? usdcRead.baseUnits : 0n,
    };
    const sui = held.SUI;
    // ② The numbers — the browser's rules, unchanged. The gas kept back is the cap the person set,
    //    or the same reserve `wallet send` keeps when none was set.
    const gasBudgetMist = options.feeCap === undefined ? undefined : clampGasBudgetMist(parseTokenAmountToBaseUnits(options.feeCap) ?? 0n);
    const keptForGas = gasBudgetMist ?? SUI_GAS_RESERVE_MIST;
    const maxIn = coinIn === "SUI" ? maxSwappableSuiMist(sui, keptForGas) : held[coinIn];
    const amountInUnits = amountRaw.toLowerCase() === "max" ? maxIn : parseTokenAmountToBaseUnits(amountRaw, COIN_DECIMALS[coinIn]);
    if (amountInUnits === null || amountInUnits <= 0n) {
        throw new NmtsError(`The amount must be a number above zero, with at most ${COIN_DECIMALS[coinIn]} decimals for ${coinIn}.`, { exitCode: 2 });
    }
    const shortOfGas = coinIn !== "SUI" && sui < keptForGas;
    if (amountInUnits > maxIn || shortOfGas) {
        const holds = [`${coinAmount(sui)} SUI`, `${coinAmount(held.WAL)} WAL`, ...(usdcRead !== null ? [`${amountOf("USDC", held.USDC)} USDC`] : [])];
        throw new NmtsError(shortOfGas
            ? `A ${coinIn} swap pays its fee in SUI, and the wallet holds less SUI than is kept back for that.`
            : "The wallet does not hold that much.", {
            exitCode: 4,
            nextStep: `Nothing was signed. The wallet holds ${holds.join(", ")}; the most that can go in is ${amountOf(coinIn, maxIn)} ${coinIn} (SUI keeps ${coinAmount(keptForGas)} back for the fee).`,
        });
    }
    let slippageBps = SLIPPAGE_BPS_DEFAULT;
    if (options.slippageBps !== undefined) {
        if (!/^\d+$/.test(options.slippageBps.trim())) {
            throw new NmtsError(`--slippage-bps must be a whole number of bps, ${SLIPPAGE_BPS_MIN} to ${SLIPPAGE_BPS_MAX} (1 bps = 0.01%).`, { exitCode: 2 });
        }
        slippageBps = clampSlippageBps(Number(options.slippageBps));
    }
    // ③ The venue and its quote. Testnet has one facility and no choice; mainnet has two and no default.
    let venue;
    let quote;
    let bluefin;
    let exchange;
    if (rails[0] === "exchange") {
        if (options.venue !== undefined)
            throw new NmtsError(`On testnet the only rail is ${venueName("exchange")}; --venue does not apply.`, { exitCode: 2 });
        if (direction !== "SUI_TO_WAL")
            throw new NmtsError(`${venueName("exchange")} only turns SUI into WAL.`, { exitCode: 2 });
        if (options.slippageBps !== undefined)
            throw new NmtsError("The testnet facility takes no minimum; --slippage-bps does not apply.", { exitCode: 2 });
        venue = "exchange";
        exchange = await reads.readExchange().catch((error) => {
            throw new NmtsError("The testnet exchange could not be read, so what it would give is unknown.", { exitCode: 1, nextStep: `Nothing was signed. ${error instanceof Error ? error.message : String(error)}` });
        });
        // The facility's rate is a fraction read off its object; there is no fee to measure and no lot to leave over.
        quote = { outUnits: (amountInUnits * exchange.rateWal) / exchange.rateSui, feeRateBps: null, leftoverInUnits: 0n, route: "direct", leftoverMidUnits: 0n };
    }
    else {
        if (options.venue !== undefined && options.venue !== "deepbook" && options.venue !== "bluefin") {
            throw new NmtsError("--venue must be deepbook or bluefin.", { exitCode: 2 });
        }
        const wanted = options.venue === undefined ? ["deepbook", "bluefin"] : [options.venue];
        const answers = await Promise.all(wanted.map(async (v) => {
            try {
                const binding = v === "bluefin" ? await reads.resolveBluefin() : null;
                return { venue: v, quote: await reads.quote(v, direction, amountInUnits, binding), why: null, binding };
            }
            catch (error) {
                return { venue: v, quote: null, why: error instanceof Error ? error.message : String(error), binding: null };
            }
        }));
        if (options.venue === undefined) {
            const lines = answers.map((a) => (a.quote === null ? `${a.venue.padEnd(9)} did not answer — ${a.why}` : quoteLine(a.quote, coinOut, coinIn)));
            if (options.json) {
                say(JSON.stringify({ direction, amountInUnits: amountInUnits.toString(), network, quotes: answers.map((a) => (a.quote === null ? { venue: a.venue, answered: false, why: a.why } : { venue: a.venue, answered: true, outUnits: a.quote.outUnits.toString(), feeRateBps: a.quote.feeRateBps, leftoverInUnits: a.quote.leftoverInUnits.toString(), route: a.quote.route, leftoverMidUnits: a.quote.leftoverMidUnits.toString() })), signed: false }));
                return 4;
            }
            say(`Quotes for ${amountOf(coinIn, amountInUnits)} ${coinIn} → ${coinOut}, read from the ${network} chain just now`);
            for (const line of lines)
                say(`  ${line}`);
            say(``);
            throw new NmtsError("Neither venue is a default, and this tool recommends neither. Choose one.", {
                exitCode: 4,
                nextStep: `Nothing was signed. Run it again with --venue deepbook or --venue bluefin. Any other exchange may be used instead.`,
            });
        }
        const only = answers[0];
        if (only === undefined || only.quote === null) {
            throw new NmtsError(`${venueName(wanted[0] ?? "deepbook")} did not answer just now.`, { exitCode: 1, nextStep: `Nothing was signed. ${only?.why ?? ""}`.trim() });
        }
        venue = only.venue;
        quote = only.quote;
        bluefin = only.binding ?? undefined;
    }
    if (quote.outUnits <= 0n) {
        throw new NmtsError(`${venueName(venue)} would give nothing for ${amountOf(coinIn, amountInUnits)} ${coinIn}: the amount is below one lot, or the book is empty.`, { exitCode: 4, nextStep: "Nothing was signed." });
    }
    const minOutUnits = venue === "exchange" ? 0n : minOutFromQuote(quote.outUnits, slippageBps);
    const shape = { venue, direction, amountInUnits, minOutUnits, gasBudgetMist, bluefin, exchange, route: quote.route };
    // ④ The fee of this exact swap. ⑤ The market check, said as unknown when it is.
    const feeMist = await reads.estimateFee(shape, address);
    const prices = await (options.readPrices ?? (async (base) => asMarketPrices(await request(base, "/api/prices").catch(() => null))))(server).catch(() => null);
    const market = marketRate(direction, prices?.suiUsd, prices?.walUsd, prices?.usdcUsd);
    const implied = impliedRate(quote.outUnits, amountInUnits, COIN_DECIMALS[coinOut], COIN_DECIMALS[coinIn]);
    const deviationBps = market !== null && implied !== null ? priceDeviationBps(implied, market) : null;
    const extremes = venue === "exchange" ? [] : swapExtremes({ slippageBps, budgetMist: gasBudgetMist ?? null, estimateMist: feeMist, deviationBps });
    // What each coin would be afterwards if the chain gives exactly the quote. USDC handed back by the
    // middle of a through-USDC route counts as USDC.
    const after = (coin) => {
        let v = held[coin];
        if (coin === coinIn)
            v -= amountInUnits - quote.leftoverInUnits;
        if (coin === coinOut)
            v += quote.outUnits;
        if (coin === "USDC")
            v += quote.leftoverMidUnits;
        if (coin === "SUI")
            v -= feeMist ?? 0n;
        return v < 0n ? 0n : v;
    };
    const showsUsdc = usdcRead !== null || quote.leftoverMidUnits > 0n;
    const facts = {
        from: address,
        venue,
        direction,
        route: quote.route,
        amountInUnits: amountInUnits.toString(),
        amountIn: amountOf(coinIn, amountInUnits),
        coinIn,
        coinOut,
        quotedOutUnits: quote.outUnits.toString(),
        quotedOut: amountOf(coinOut, quote.outUnits),
        minOutUnits: minOutUnits.toString(),
        minOut: amountOf(coinOut, minOutUnits),
        slippageBps: venue === "exchange" ? null : slippageBps,
        venueFeeBps: quote.feeRateBps,
        leftoverInUnits: quote.leftoverInUnits.toString(),
        leftoverMidUsdcUnits: quote.leftoverMidUnits.toString(),
        feeMist: feeMist === null ? null : feeMist.toString(),
        feeSui: feeMist === null ? null : coinAmount(feeMist),
        feeCapMist: gasBudgetMist === undefined ? null : gasBudgetMist.toString(),
        deviationBps: deviationBps === null ? null : Math.round(deviationBps * 100) / 100,
        extremes,
        network,
        suiAfter: coinAmount(after("SUI")),
        walAfter: coinAmount(after("WAL")),
        usdcAfter: showsUsdc ? amountOf("USDC", after("USDC")) : null,
    };
    // ⑥ The review, every time.
    if (!options.json) {
        say(`Swapping ${facts.amountIn} ${coinIn} for ${coinOut} on ${venueName(venue)}`);
        say(`  from      ${address} (wallet ${wallet})`);
        if (quote.route === "viaUsdc")
            say(`  Route     ${coinIn} → USDC → ${coinOut}, two pools in one transaction; the minimum covers the whole trade`);
        say(`  Quoted    ${facts.quotedOut} ${coinOut} — the chain's answer just now, not a promise${quote.leftoverInUnits > 0n ? `; ${amountOf(coinIn, quote.leftoverInUnits)} ${coinIn} would come back unused` : ""}${quote.leftoverMidUnits > 0n ? `; ${amountOf("USDC", quote.leftoverMidUnits)} USDC would come back unused` : ""}`);
        if (venue === "exchange")
            say(`  Rate      ${exchange?.rateWal} WAL per ${exchange?.rateSui} SUI, read off the facility; it takes no minimum`);
        else
            say(`  At least  ${facts.minOut} ${coinOut}, or the swap fails on chain — slippage ${slippageBps} bps (${pct(slippageBps)})`);
        say(quote.feeRateBps === null ? `  Venue fee: could not be measured from the quote just now` : `  Venue fee about ${pct(quote.feeRateBps)} of what goes in, measured from the quote`);
        say(feeMist === null ? `  Chain fee (SUI): could not be measured just now; it is charged with the signature` : `  Chain fee about ${facts.feeSui} SUI, measured by a dry run just now — the amount charged is fixed when it executes`);
        if (gasBudgetMist !== undefined)
            say(`  Fee cap   ${coinAmount(gasBudgetMist)} SUI — only up to this is used; the rest stays`);
        say(deviationBps === null ? `  Market    no reference price could be read just now, so the quote was not compared with the market` : `  Market    ${pct(deviationBps)} from the site's reference price (1 ${coinIn} ≈ ${market?.toFixed(4)} ${coinOut})`);
        say(`  Afterwards, if the chain gives exactly the quote: about ${facts.suiAfter} SUI and ${facts.walAfter} WAL${facts.usdcAfter === null ? "" : ` and ${facts.usdcAfter} USDC`}`);
        say(``);
        say(`  NMTS is not a party to this trade and takes nothing from it. Any other exchange may be used instead.`);
        if (extremes.length > 0) {
            say(``);
            say(`  ⛔ Outside the ordinary bands:`);
            for (const e of extremes)
                say(`     · ${EXTREME_WORDS[e]}`);
        }
    }
    // ⑦ The extremes gate: refused, unless a person said so.
    if (extremes.length > 0 && options.dryRun !== true) {
        if (options.acceptExtremes !== true) {
            if (options.json) {
                say(JSON.stringify({ ...facts, signed: false, refused: "extremes" }));
                return 4;
            }
            throw new NmtsError("Nothing was signed: this swap is outside the ordinary bands.", {
                exitCode: 4,
                nextStep: `Choose again (--slippage-bps 50, a different --fee-cap, the other venue, or later), or — as a person — add --accept-extremes to go on anyway.`,
            });
        }
        const mode = await currentMode();
        if (mode === "auto-low" || mode === "auto-high") {
            throw new NmtsError("Going past the extremes gate is a person's act.", { exitCode: 5, nextStep: `Nothing was signed. --accept-extremes is refused in mode auto and with --skip-permissions.` });
        }
    }
    // ⑧ Without --yes, that is the end.
    if (options.dryRun === true || options.yes !== true) {
        if (options.json) {
            say(JSON.stringify({ ...facts, signed: false, dryRun: options.dryRun === true }));
            return options.dryRun === true ? 0 : 4;
        }
        say(``);
        if (options.dryRun === true) {
            say(`  Nothing was signed. Run the same command with --yes to swap.`);
            return 0;
        }
        throw new NmtsError("Nothing was signed: swapping needs --yes.", {
            exitCode: 4,
            nextStep: `Read the review above, then run the same command with --yes. The quote will be read again; the chain gives what it gives, never less than the minimum.`,
        });
    }
    // ⑨ The agreement — scope `all`, the amount and the fee held against its ceiling.
    const spend = {
        walFrost: coinIn === "WAL" ? amountInUnits : 0n,
        suiMist: (coinIn === "SUI" ? amountInUnits : 0n) + (feeMist ?? 0n),
    };
    const grant = requireWalletGrant("exchange", spend, new Date(options.now ?? Date.now()));
    // ⛔ The agreement's ceilings count SUI and WAL. A USDC spend cannot be held against them, so under
    //    an agreement that HAS a ceiling it is refused rather than signed uncounted.
    if (coinIn === "USDC" && (grant.capWalFrost !== null || grant.capSuiMist !== null)) {
        throw new NmtsError("The wallet agreement on this machine has a spending ceiling, and its ceilings count SUI and WAL only.", {
            exitCode: 5,
            nextStep: `Nothing was signed. A USDC swap under a ceiling would go uncounted, so it is refused. To swap USDC, agree again without --cap-wal and --cap-sui:  ${BINARY_NAME} unlock wallet --days 7 --scope all`,
        });
    }
    // ⑩ The signature.
    const sign = options.sign ?? (await import("../wallet-sign.js")).signSwap;
    const digest = await sign({ network, code: resolved.code, wallet, shape });
    recordWalletSpend(spend);
    if (options.json) {
        say(JSON.stringify({ ...facts, signed: true, digest, explorerUrl: explorerTxUrl(digest, network) }));
        return 0;
    }
    say(``);
    say(`  Swapped. Transaction ${digest}`);
    say(`  ${explorerTxUrl(digest, network)}`);
    say(`  What arrived is what the chain gave — at least the minimum above. \`${BINARY_NAME} wallet\` shows the SUI and WAL balances now.`);
    return 0;
}

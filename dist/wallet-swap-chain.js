// The swap transaction and its live reads: the wallet's balances, the version check on Bluefin's
// PINNED package, the testnet facility's rate, and the fee a dry run measures. Bluefin's package id
// itself is NOT a live read — see the block above `checkedBluefinBinding`. The quotes live next door
// in `wallet-swap-quote.ts`; both files read, and only `wallet-sign.ts` signs.
//
// ⛔ ONE BUILDER FOR THE FEE AND THE SIGNATURE. `estimateFee` and `wallet-sign.ts` both call
//    `swapTransaction`, so the fee printed is the fee of the transaction that is then signed.
//
// ⛔ THE SHAPES ARE THE BROWSER'S, CALL FOR CALL. DeepBook: `pool::swap_exact_base_for_quote` when the
//    coin going in is the pool's first coin (base), `swap_exact_quote_for_base` when it is the second,
//    with an EMPTY DEEP coin so the fee comes off the input coin, and all THREE outputs (base, quote,
//    DEEP) sent back to the signer — Move cannot drop a coin, so a forgotten one aborts the whole
//    transaction. Through USDC (WAL ↔ SUI only), the first pool's USDC coin goes straight into the
//    second pool in the same transaction, the minimum is put on the last pool, and the first pool's
//    leftover comes back too. Bluefin: `gateway::swap_assets`, which sends its outputs to the sender
//    itself; type arguments always in pool order (first coin = coin_a), the direction carried by the
//    `a2b` flag, and a sqrt-price limit one step inside the tick range (the exact end aborts). Testnet:
//    the official Walrus facility `wal_exchange::exchange_all_for_wal`, SUI→WAL only, whose package is
//    read off the Exchange object's own type. The ids come from `shared/lib/wallet/venue-ids.ts`,
//    copied byte-for-byte from the browser.
//
// ⛔ OUR SHARE IS ZERO. No NMTS address, no fee argument, no output of ours in any of the three.
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { TESTNET_WALRUS_PACKAGE_CONFIG } from "@mysten/walrus";
import { walrusClient, netGasFee } from "./extend-chain.js";
import { isRecord } from "./guards.js";
import { hopFor, routeHops } from "./shared/lib/wallet/swap-routes.js";
import { directionCoins } from "./shared/lib/wallet/swap-rules.js";
import { BLUEFIN_GLOBAL_CONFIG_IDS, BLUEFIN_MAX_SQRT_PRICE, BLUEFIN_MIN_SQRT_PRICE, BLUEFIN_PACKAGE_IDS, BLUEFIN_SUI_USDC_POOLS, BLUEFIN_WAL_SUI_POOLS, BLUEFIN_WAL_USDC_POOLS, DEEP_COIN_TYPES, DEEPBOOK_PACKAGE_IDS, } from "./shared/lib/wallet/venue-ids.js";
import { readBalances, readCoinOfType } from "./wallet.js";
import { chainReader } from "./wallet-chain.js";
import { deepbookPools, pairTypes, poolIdOf, quoteVenue, QUOTE_SENDER, swapCoinTypes, } from "./wallet-swap-quote.js";
/** Bluefin's pinned pools on a network. */
export function bluefinPools(network) {
    return {
        WAL_SUI: BLUEFIN_WAL_SUI_POOLS[network],
        SUI_USDC: BLUEFIN_SUI_USDC_POOLS[network],
        WAL_USDC: BLUEFIN_WAL_USDC_POOLS[network],
    };
}
/** The rails a network has. Testnet's DeepBook book trades a different WAL, and Bluefin has none. */
export function railsFor(network) {
    return network === "mainnet" ? ["deepbook", "bluefin"] : ["exchange"];
}
export function swapTransaction(input) {
    const tx = new Transaction();
    tx.setSender(input.sender);
    const types = swapCoinTypes(input.network);
    const { in: coinFrom, out: coinTo } = directionCoins(input.direction);
    // SUI comes off the gas coin; WAL and USDC are gathered from the wallet by their EXACT types.
    const coinOf = (coin) => coin === "SUI"
        ? tx.splitCoins(tx.gas, [input.amountInUnits])[0]
        : tx.add(coinWithBalance({ balance: input.amountInUnits, type: types[coin] }));
    if (input.venue === "deepbook") {
        const route = input.route ?? "direct";
        const hops = routeHops(input.direction, route);
        if (hops === null || hops.length === 0)
            throw new Error(`DeepBook has no ${route} route for ${input.direction}.`);
        const pools = deepbookPools(input.network);
        let coin = coinOf(coinFrom);
        let deep = tx.moveCall({ target: "0x2::coin::zero", typeArguments: [DEEP_COIN_TYPES[input.network]] });
        const back = [];
        hops.forEach((hop, i) => {
            const last = i === hops.length - 1;
            const swapped = tx.moveCall({
                target: `${DEEPBOOK_PACKAGE_IDS[input.network]}::pool::${hop.sellsFirst ? "swap_exact_base_for_quote" : "swap_exact_quote_for_base"}`,
                typeArguments: pairTypes(input.network, hop.pair),
                arguments: [tx.object(poolIdOf(pools, hop.pair, "deepbook")), coin, deep, tx.pure.u64(last ? input.minOutUnits : 0n), tx.object.clock()],
            });
            // The result is indexed, and an index is typed as possibly absent; nothing below can build a
            // transfer of fewer than the three outputs.
            const [baseCoin, quoteCoin, deepCoin] = [swapped[0], swapped[1], swapped[2]];
            if (baseCoin === undefined || quoteCoin === undefined || deepCoin === undefined) {
                throw new Error("DeepBook's swap did not yield its three outputs.");
            }
            if (last) {
                back.push(baseCoin, quoteCoin, deepCoin);
            }
            else {
                // The first pool's leftover goes home; what it bought feeds the next pool, with its empty DEEP.
                back.push(hop.sellsFirst ? baseCoin : quoteCoin);
                coin = hop.sellsFirst ? quoteCoin : baseCoin;
                deep = deepCoin;
            }
        });
        tx.transferObjects(back, input.sender);
    }
    else if (input.venue === "bluefin") {
        if (input.bluefin === undefined)
            throw new Error("A Bluefin swap needs its resolved package first.");
        const hop = hopFor(coinFrom, coinTo);
        const a2b = hop.sellsFirst;
        const coinIn = coinOf(coinFrom);
        const coinZero = tx.moveCall({ target: "0x2::coin::zero", typeArguments: [types[coinTo]] });
        tx.moveCall({
            target: `${input.bluefin.packageId}::gateway::swap_assets`,
            typeArguments: pairTypes(input.network, hop.pair),
            arguments: [
                tx.object.clock(),
                tx.object(input.bluefin.globalConfigId),
                tx.object(poolIdOf(input.bluefin.pools, hop.pair, "bluefin")),
                a2b ? coinIn : coinZero,
                a2b ? coinZero : coinIn,
                tx.pure.bool(a2b),
                tx.pure.bool(true),
                tx.pure.u64(input.amountInUnits),
                tx.pure.u64(input.minOutUnits),
                tx.pure.u128(a2b ? BLUEFIN_MIN_SQRT_PRICE : BLUEFIN_MAX_SQRT_PRICE),
            ],
        });
    }
    else {
        if (input.exchange === undefined)
            throw new Error("The testnet exchange needs its object first.");
        if (input.direction !== "SUI_TO_WAL")
            throw new Error("The testnet facility only turns SUI into WAL.");
        const coinIn = coinOf("SUI");
        const walOut = tx.moveCall({
            target: `${input.exchange.packageId}::wal_exchange::exchange_all_for_wal`,
            arguments: [tx.object(input.exchange.objectId), coinIn],
        });
        tx.transferObjects([walOut], input.sender);
    }
    if (input.gasBudgetMist !== undefined)
        tx.setGasBudget(input.gasBudgetMist);
    return tx;
}
/** `fields.<name>` of a Move object's content, as a string, or null when the shape differs. */
function fieldOf(content, name) {
    const fields = isRecord(content) ? content["fields"] : undefined;
    return isRecord(fields) ? fields[name] : undefined;
}
/** Does the chain still accept this package? `config::verify_version` under devInspect: no signature,
 *  no gas. False when the chain refuses AND when the RPC cannot answer — both mean "no Bluefin". */
async function versionPasses(rpc, packageId, globalConfigId) {
    try {
        const tx = new Transaction();
        tx.moveCall({ target: `${packageId}::config::verify_version`, arguments: [tx.object(globalConfigId)] });
        const res = await rpc.devInspectTransactionBlock({ sender: QUOTE_SENDER, transactionBlock: tx });
        return !res.error;
    }
    catch {
        return false;
    }
}
/** The pinned addresses, returned only once the chain confirms the pinned package still verifies.
 *  A refusal ends it: this function has no other address to return. Exported so the test can hold an
 *  RPC that names a different package and watch it change nothing. */
export async function checkedBluefinBinding(pinned, rpc) {
    if (!(await versionPasses(rpc, pinned.packageId, pinned.globalConfigId))) {
        throw new Error("Bluefin's on-chain version check refused the package address this tool pins.");
    }
    return pinned;
}
export function swapReads(network) {
    const client = walrusClient(network);
    let bluefin = null;
    return {
        async readWallet(address) {
            return readBalances(chainReader(network, address), swapCoinTypes(network).WAL);
        },
        async readUsdc(address) {
            return readCoinOfType(chainReader(network, address), swapCoinTypes(network).USDC, "USDC");
        },
        async resolveBluefin() {
            // Memoised for the run, and a failure is not memoised: one refusal must not become "no Bluefin".
            if (bluefin !== null)
                return bluefin;
            const pending = (async () => {
                const packageId = BLUEFIN_PACKAGE_IDS[network];
                const globalConfigId = BLUEFIN_GLOBAL_CONFIG_IDS[network];
                if (packageId === null || globalConfigId === null || BLUEFIN_WAL_SUI_POOLS[network] === null) {
                    throw new Error(`This tool knows no Bluefin WAL/SUI pool on ${network}.`);
                }
                return checkedBluefinBinding({ packageId, globalConfigId, pools: bluefinPools(network) }, client);
            })();
            bluefin = pending;
            pending.catch(() => {
                if (bluefin === pending)
                    bluefin = null;
            });
            return pending;
        },
        async readExchange() {
            if (network !== "testnet")
                throw new Error("The built-in SUI→WAL exchange is a testnet-only facility.");
            const objectId = TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0];
            if (objectId === undefined)
                throw new Error("This build names no testnet exchange object.");
            const obj = await client.getObject({ id: objectId, options: { showContent: true, showType: true } });
            const type = obj.data?.type;
            if (typeof type !== "string" || !type.includes("::wal_exchange::Exchange")) {
                throw new Error(`Object ${objectId} is not a wal_exchange Exchange (type ${type ?? "unknown"}).`);
            }
            const rate = fieldOf(obj.data?.content, "rate");
            const wal = fieldOf(rate, "wal");
            const sui = fieldOf(rate, "sui");
            if (typeof wal !== "string" || typeof sui !== "string" || !/^\d+$/.test(wal) || !/^\d+$/.test(sui) || BigInt(sui) === 0n) {
                throw new Error("The exchange's rate could not be read off its object, so what it would give is unknown.");
            }
            return { objectId, packageId: type.split("::")[0] ?? "", rateWal: BigInt(wal), rateSui: BigInt(sui) };
        },
        async quote(venue, direction, amountInUnits, binding) {
            return quoteVenue(client, network, venue, direction, amountInUnits, binding);
        },
        async estimateFee(shape, sender) {
            try {
                const bytes = await swapTransaction({ ...shape, network, sender }).build({ client });
                const { effects } = await client.dryRunTransactionBlock({ transactionBlock: bytes });
                if (effects.status.status !== "success")
                    return null;
                return netGasFee(effects.gasUsed);
            }
            catch {
                return null;
            }
        },
    };
}

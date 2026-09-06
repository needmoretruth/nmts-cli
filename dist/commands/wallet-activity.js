// `nmts wallet activity` — the recent transactions of the wallet this account code derives.
//
// ⛔ IT READS. The chain is asked twice (sent, received — the RPC filter has no OR), the rows are
//    named by the SAME judgement the browser uses (`shared/lib/wallet/activity.ts`, copied
//    byte-for-byte), and nothing here signs or spends.
//
// ⛔ A NAME IS PUT ONLY WHERE A CONSTANT PROVES IT. What this tool cannot prove it prints as
//    "other" — with the time, the balance changes and the chain link still there. Two things the
//    browser knows and this tool does not: the developer's donation address and the free-trial
//    pool's, which the server keeps to itself. So here a gift shows as a plain send, and a fee the
//    pool paid shows as paid by "another address". Both are said below the list, once.
//
// ⛔ AN UNANSWERED CHAIN IS NOT AN EMPTY LIST. A read that fails exits non-zero and says so; the
//    empty list is printed only when the chain answered and had nothing.
import { MAINNET_WALRUS_PACKAGE_CONFIG, TESTNET_WALRUS_PACKAGE_CONFIG } from "@mysten/walrus";
import { requireAccountCode } from "../code-access.js";
import { readCredentialsFile } from "../credentials.js";
import { NmtsError } from "../errors.js";
import { resolveNetwork } from "../network.js";
import { BINARY_NAME } from "../product.js";
import { resolveServer } from "../server.js";
import { mergeActivity, toActivityRow, } from "../shared/lib/wallet/activity.js";
import { BLUEFIN_PACKAGE_IDS, DEEPBOOK_PACKAGE_IDS } from "../shared/lib/wallet/venue-ids.js";
import { coinAmount, walCoinType, walletAddress } from "../wallet.js";
/** How many to ask for in each direction, and how many to print after the merge. */
export const FETCH_PER_DIRECTION = 25;
export const SHOW = 20;
/** What the judgement compares against on this network. Donation and pool addresses: unknown here. */
export function activityContext(network, address) {
    const walrus = network === "mainnet" ? MAINNET_WALRUS_PACKAGE_CONFIG : TESTNET_WALRUS_PACKAGE_CONFIG;
    return {
        address,
        donationAddresses: [],
        poolAddress: "",
        walCoinType: walCoinType(network),
        walrusSystemObjectId: walrus.systemObjectId,
        deepbookPackageId: DEEPBOOK_PACKAGE_IDS[network],
        bluefinPackageId: BLUEFIN_PACKAGE_IDS[network],
        exchangeObjectId: network === "testnet" ? (TESTNET_WALRUS_PACKAGE_CONFIG.exchangeIds[0] ?? null) : null,
        network,
    };
}
export async function walletActivity(options = {}) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const resolved = await requireAccountCode();
    const address = await walletAddress(resolved.code);
    const stored = resolved.source === "file" || resolved.source === "file-locked" ? readCredentialsFile() : null;
    const server = resolveServer(options.server ?? stored?.server);
    const network = resolveNetwork(server, options.network ?? stored?.network);
    const query = options.queryChain ?? (async (net, addr) => (await import("../wallet-activity-chain.js")).queryActivity(net, addr));
    let fetched;
    try {
        fetched = await query(network, address);
    }
    catch (error) {
        throw new NmtsError("The wallet's transactions could not be read from the chain.", {
            exitCode: 1,
            nextStep: `Nothing is known about this wallet's activity from here — that is not the same as there ` +
                `being none. \`${BINARY_NAME} env\` says which network was asked. ` +
                `Cause: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
    const ctx = activityContext(network, address);
    const rows = mergeActivity([fetched.sent.map((tx) => toActivityRow(tx, ctx)), fetched.received.map((tx) => toActivityRow(tx, ctx))], SHOW);
    if (options.json) {
        say(JSON.stringify({ address, network, shown: rows.length, rows: rows.map(asJson) }));
        return 0;
    }
    say(`Address  ${address}`);
    say(`Network  ${network}`);
    say(``);
    if (rows.length === 0) {
        say(`  The chain answered and lists no transaction for this wallet.`);
    }
    else {
        for (const row of rows)
            say(`  ${inWords(row)}`);
    }
    say(``);
    say(`  The newest ${SHOW} at most; the chain link on each line shows the rest. A name is put only`);
    say(`  where the transaction proves it — the storage network's own calls, the two exchanges, a`);
    say(`  plain transfer. Anything else is "other". Gifts to the developer show here as sends, and a`);
    say(`  fee the free-trial pool paid shows as paid by another address: this tool does not know`);
    say(`  those two addresses.`);
    return 0;
}
/** An amount with its sign — `coinAmount` formats magnitudes, and a balance change has a direction. */
function signed(amount) {
    return amount < 0n ? `-${coinAmount(-amount)}` : `+${coinAmount(amount)}`;
}
/** One row, for a person: when · what · how much of which coin · who paid the fee · the link. */
function inWords(row) {
    const when = row.atMs === null ? "time unknown      " : new Date(row.atMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    const changes = row.changes.length === 0
        ? "no balance change"
        : row.changes.map((c) => `${signed(c.amount)} ${c.coin ?? c.coinType}`).join(", ");
    const fee = row.gasPayer === "self" ? "" : "  fee paid by another address";
    const failed = row.failed ? "  ⛔ FAILED on chain" : "";
    return `${when}  ${row.kind.padEnd(8)}  ${changes}${fee}${failed}\n    ${row.explorerUrl}`;
}
/** One row, for a program. ⚠ Amounts are strings: base units run past what a JSON number keeps. */
function asJson(row) {
    return {
        digest: row.digest,
        at: row.atMs === null ? null : new Date(row.atMs).toISOString(),
        kind: row.kind,
        failed: row.failed,
        gasPayer: row.gasPayer,
        changes: row.changes.map((c) => ({
            coin: c.coin,
            coinType: c.coinType,
            baseUnits: c.amount.toString(),
            amount: signed(c.amount),
        })),
        explorerUrl: row.explorerUrl,
    };
}

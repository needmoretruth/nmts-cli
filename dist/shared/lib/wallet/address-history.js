// The transactions that moved one address — asked of a Sui node over gRPC, and of Sui's GraphQL
// service for what the node no longer keeps. ⚠ PUBLISHED — copied byte-for-byte into the `nmts`
// command-line package; keep comments self-contained English.
//
// ⛔ WHY ONE QUESTION, WHERE THERE USED TO BE TWO (2026-10-21). The retired JSON-RPC could filter
//    transactions by `FromAddress` or by `ToAddress` and had no OR, so "sent" and "received" were two
//    queries everywhere — the wallet walk, the activity list, both in the browser and in the
//    command-line tool. The gRPC ledger index has the filter that was actually meant:
//    `affectedAddress` — every transaction after which this address owns, lost or changed an object,
//    or whose address balance moved. Sending pays gas from the sender's coin, so a send is in it;
//    receiving gives the address an object, so a receipt is in it.
//
// ⛔ A gRPC NODE KEEPS A WINDOW, NOT THE HISTORY (measured 2026-10-21). Each node answers only from
//    the checkpoints it still holds, and says where that ends: a scan with nothing in it stops with
//    `CHECKPOINT_BOUND` at the node's lowest available checkpoint. Mysten Labs' fullnode held about
//    the last three weeks on both networks; Suiscan's held two weeks on mainnet and the last few
//    SECONDS on testnet. So "the node found nothing" means "nothing lately" — a wallet funded in
//    August and idle since read as never used, which is how a funded wallet vanishes from a screen.
//    What the window does not cover is asked of Sui's public GraphQL service, which answered the same
//    filter back to 2023 on both networks; its rows are read by the SAME parser as the node's (its
//    `transactionJson` and `balanceChangesJson` are the gRPC messages written as JSON).
//
// ⛔ A REQUEST WITHOUT A START IS REFUSED (measured 2026-11-07). Without `startCheckpoint` a scan
//    starts at genesis, and since about 2026-11-05 Suiscan and Mysten Labs refuse that ("requested data
//    below earliest available; lowest available checkpoint is <n>"), which failed every wallet walk and
//    activity list before the deeper source was asked. A refused read is sent again from just above the
//    floor it names (or, when the node holds fewer checkpoints than the margin and refuses that as above
//    its top, from the middle of the window), the window is remembered per network, and the scan ends
//    at that start: what lies below it is the deeper source's to answer.
//
// ⛔ A SCAN THAT STOPPED SHORT IS NOT "NOTHING THERE". The node also bounds how much of its index one
//    request reads; a request can end with fewer items than asked — even none — and say it stopped
//    because of that bound (`SCAN_LIMIT`). This file follows the cursor for a bounded number of
//    requests. Whatever it could not settle is `complete: false`, so a caller can tell "no history"
//    from "did not finish looking".
//
// ⚠ It needs the gRPC client: the filter is a raw ledger-service filter, which the SDK's top-level
//   `listTransactions` does not offer (it filters by sender or function only).
import { GrpcTypes, parseGrpcTransactionResponse } from "@mysten/sui/grpc";
/** How many requests one question may take before it answers with what it has. */
const MAX_REQUESTS = 8;
/**
 * How far above a node's lowest checkpoint a read starts, at most. Mainnet seals about four
 * checkpoints a second, so 20,000 is over an hour of pruning before the start falls out of the window
 * again. A node whose whole window is shorter (Suiscan's testnet node held 54 checkpoints, about
 * 13 seconds, on 2026-11-07) refuses that start as above its top and names the top; the start is then
 * the middle of the window it named. Same rule as the chain service's gift reader.
 */
export const WINDOW_MARGIN = 20000n;
/** Refusals answered by moving the start before the read counts as failed (floor, top, one stale floor). */
const MAX_WINDOW_RETRIES = 3;
// Per network (or per client when it names none, as a test's fake does), so a page that asks many
// times pays the refusals once. Hosts of one network share it: a floor too low for another host is
// refused and corrected, and half the shortest span is inside every host's window.
const windowByNetwork = new Map();
const windowByClient = new WeakMap();
function networkOf(client) {
    return "network" in client && typeof client.network === "string" ? client.network : undefined;
}
function knownWindow(client) {
    const network = networkOf(client);
    return network === undefined ? windowByClient.get(client) : windowByNetwork.get(network);
}
function rememberWindow(client, window) {
    const network = networkOf(client);
    if (network === undefined)
        windowByClient.set(client, window);
    else
        windowByNetwork.set(network, window);
}
/** Where a read starts inside what is known of the window; `undefined` (genesis) until a refusal said. */
function startInside(window) {
    if (window === undefined)
        return undefined;
    const half = window.span === null ? WINDOW_MARGIN : window.span / 2n;
    return window.floor + (half < WINDOW_MARGIN ? half : WINDOW_MARGIN);
}
/** Learns from a window refusal and says whether it was one; any other error teaches nothing. */
function learnWindow(client, e) {
    const known = knownWindow(client);
    const lowest = lowestAvailable(e);
    if (lowest !== null) {
        rememberWindow(client, { floor: lowest, span: known?.span ?? null });
        return true;
    }
    const below = highestAvailable(e);
    if (below === null || known === undefined)
        return false;
    rememberWindow(client, { floor: known.floor, span: below > known.floor ? below - known.floor : 1n });
    return true;
}
/**
 * The checkpoint a node's window ends below, read from its refusal of a start above it, or `null`
 * for any other error. Suiscan and Mysten Labs answered `requested data above latest available;
 * start_checkpoint is <s>, and only checkpoints below <n> are available` on 2026-11-07.
 */
export function highestAvailable(e) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const found = /only checkpoints below (\d{1,20}) are available/.exec(message);
    return found === null || found[1] === undefined ? null : BigInt(found[1]);
}
/**
 * The lowest checkpoint a node said it holds, read from its refusal, or `null` for any other error.
 * Suiscan and Mysten Labs both answered `requested data below earliest available; lowest available
 * checkpoint is <n>` on 2026-11-07.
 */
export function lowestAvailable(e) {
    const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const found = /lowest available checkpoint is (\d{1,20})/.exec(message);
    return found === null || found[1] === undefined ? null : BigInt(found[1]);
}
/** The fields the parser reads for `{ transaction, balanceChanges }` (the SDK's own read mask, by name). */
const READ_MASK = [
    "digest",
    "transaction.digest",
    "signatures",
    "effects.status",
    "timestamp",
    "checkpoint",
    "transaction.sender",
    "transaction.gas_payment",
    "transaction.expiration",
    "transaction.kind",
    "balance_changes",
];
async function recentTransactions(client, address, limit, signal) {
    const transactions = [];
    let before;
    for (let request = 0; request < MAX_REQUESTS; request += 1) {
        let frontier;
        let reachedCheckpoint;
        let reason;
        for (let attempt = 0;; attempt += 1) {
            const startCheckpoint = startInside(knownWindow(client));
            // Rows of one attempt are kept only if the attempt finishes: a refusal mid-stream adds nothing.
            const rows = [];
            frontier = undefined;
            reachedCheckpoint = undefined;
            reason = undefined;
            try {
                const call = client.ledgerService.listTransactions({
                    ...(startCheckpoint === undefined ? {} : { startCheckpoint }),
                    readMask: { paths: READ_MASK },
                    filter: {
                        terms: [
                            {
                                literals: [
                                    { negated: false, predicate: { oneofKind: "affectedAddress", affectedAddress: { address } } },
                                ],
                            },
                        ],
                    },
                    options: {
                        limit: limit - transactions.length,
                        ordering: GrpcTypes.Ordering.DESCENDING,
                        ...(before === undefined ? {} : { before }),
                    },
                }, signal === undefined ? {} : { abort: signal });
                for await (const frame of call.responses) {
                    if (frame.watermark?.cursor !== undefined)
                        frontier = frame.watermark.cursor;
                    if (frame.watermark?.checkpoint !== undefined)
                        reachedCheckpoint = frame.watermark.checkpoint;
                    if (frame.transaction !== undefined && transactions.length + rows.length < limit) {
                        const parsed = parseGrpcTransactionResponse(frame.transaction, {
                            include: { transaction: true, balanceChanges: true },
                        });
                        const tx = parsed.Transaction ?? parsed.FailedTransaction;
                        if (tx !== undefined)
                            rows.push(tx);
                    }
                    if (frame.end !== undefined)
                        reason = frame.end.reason;
                }
                transactions.push(...rows);
                break;
            }
            catch (e) {
                // A read the caller called off is called off; it is not a node failing.
                if (signal?.aborted === true)
                    throw e;
                // ⛔ ANY OTHER REFUSAL LEAVES THE NODE'S PART UNREAD, AND THE DEEPER SOURCE IS ASKED (2026-11-09). This
                //    used to throw on a refusal whose wording it did not know, so one changed sentence in a
                //    node's reply emptied every wallet's activity again (as on 2026-11-05); a node with no connection
                //    did the same. What the node could not give is what GraphQL is for. A window no start can
                //    hit (Suiscan's testnet replicas disagreed by more than its 54 checkpoints, 2026-11-07)
                //    ends the same way.
                if (!learnWindow(client, e))
                    return { transactions, fromGenesis: false, failed: e };
                if (attempt >= MAX_WINDOW_RETRIES)
                    return { transactions, fromGenesis: false };
            }
        }
        if (transactions.length >= limit)
            return { transactions, fromGenesis: true };
        // A scan bound means "there may be more, carry on from here".
        if (reason === GrpcTypes.QueryEndReason.SCAN_LIMIT && frontier !== undefined) {
            before = frontier;
            continue;
        }
        // ⛔ Newest-first, the scan ends at the oldest checkpoint the node still holds. Only when that is
        //    the chain's first checkpoint has it seen everything; any other ending is the window's edge.
        return {
            transactions,
            fromGenesis: reason === GrpcTypes.QueryEndReason.CHECKPOINT_BOUND && reachedCheckpoint === 0n,
        };
    }
    return { transactions, fromGenesis: false };
}
/** Newest first; rows the node gave win over the same rows from the deeper source (they are fresher). */
function mergeNewestFirst(recent, deeper, limit) {
    const seen = new Set(recent.map((tx) => tx.digest));
    const all = [...recent, ...deeper.filter((tx) => !seen.has(tx.digest))];
    // A row without a time sorts last: it cannot be placed, and it must not push a dated row out.
    const time = (tx) => tx.timestampMs ?? Number.NEGATIVE_INFINITY;
    return all.sort((a, b) => time(b) - time(a)).slice(0, limit);
}
/**
 * The newest transactions that moved `address`'s state, newest first.
 *
 * @param limit - how many to return at most; 1 is the cheapest "has this address any history".
 * @param deeper - where to read past the node's window; `null` when the caller named its own node and
 *   asked for nothing else (the answer is then `complete: false` whenever the window ran out).
 */
export async function addressTransactions(client, address, limit, signal, deeper = null) {
    const recent = await recentTransactions(client, address, limit, signal);
    if (recent.fromGenesis)
        return { transactions: recent.transactions, complete: true };
    // ⛔ A node that failed and gave nothing, with nobody else to answer, is "could not read", not a
    //    partial list: the screen says it failed rather than "older history is missing" over no rows.
    const unread = recent.failed !== undefined && recent.transactions.length === 0;
    if (deeper === null) {
        if (unread)
            throw recent.failed;
        return { transactions: recent.transactions, complete: false };
    }
    try {
        const older = await deeper(address, limit, signal);
        return { transactions: mergeNewestFirst(recent.transactions, older, limit), complete: true };
    }
    catch (e) {
        if (unread)
            throw recent.failed ?? e;
        // The node's rows stand; the answer says plainly that it is not the whole history.
        return { transactions: recent.transactions, complete: false };
    }
}
/**
 * Has `address` ever been in a transaction? Throws when nobody could finish looking — "nobody could
 * tell" and "nothing is there" are opposite facts, and only the second may answer `false`.
 */
export async function hasAddressHistory(client, address, signal, deeper = null) {
    const { transactions, complete } = await addressTransactions(client, address, 1, signal, deeper);
    if (transactions.length > 0)
        return true;
    if (!complete)
        throw new Error(`The chain did not finish looking for transactions of ${address}.`);
    return false;
}
// The deeper source (Sui's GraphQL services) lives in `graphql-history.ts`; both names stay importable here.
export { graphqlHistory, SUI_GRAPHQL_URLS } from "./graphql-history.js";

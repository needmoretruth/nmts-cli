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
// ⛔ A SCAN THAT STOPPED SHORT IS NOT "NOTHING THERE". The node also bounds how much of its index one
//    request reads; a request can end with fewer items than asked — even none — and say it stopped
//    because of that bound (`SCAN_LIMIT`). This file follows the cursor for a bounded number of
//    requests. Whatever it could not settle is `complete: false`, so a caller can tell "no history"
//    from "did not finish looking".
//
// ⚠ It needs the gRPC client: the filter is a raw ledger-service filter, which the SDK's top-level
//   `listTransactions` does not offer (it filters by sender or function only).
import { GrpcTypes, parseGrpcTransactionResponse } from "@mysten/sui/grpc";
/**
 * Sui's public GraphQL service per network (Mysten Labs). Measured 2026-10-21: the `affectedAddress`
 * filter answered back to 2023 on both networks, in 0.2–0.9 s, with `access-control-allow-origin: *`.
 * It is the only public operator of it, so it is the second tier and never the only one: a failure
 * here leaves the answer `complete: false`, never "nothing there".
 */
export const SUI_GRAPHQL_URLS = {
    mainnet: "https://graphql.mainnet.sui.io/graphql",
    testnet: "https://graphql.testnet.sui.io/graphql",
};
/** How many requests one question may take before it answers with what it has. */
const MAX_REQUESTS = 8;
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
        const call = client.ledgerService.listTransactions({
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
        let frontier;
        let reachedCheckpoint;
        let reason;
        for await (const frame of call.responses) {
            if (frame.watermark?.cursor !== undefined)
                frontier = frame.watermark.cursor;
            if (frame.watermark?.checkpoint !== undefined)
                reachedCheckpoint = frame.watermark.checkpoint;
            if (frame.transaction !== undefined && transactions.length < limit) {
                const parsed = parseGrpcTransactionResponse(frame.transaction, {
                    include: { transaction: true, balanceChanges: true },
                });
                const tx = parsed.Transaction ?? parsed.FailedTransaction;
                if (tx !== undefined)
                    transactions.push(tx);
            }
            if (frame.end !== undefined)
                reason = frame.end.reason;
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
    if (deeper === null)
        return { transactions: recent.transactions, complete: false };
    try {
        const older = await deeper(address, limit, signal);
        return { transactions: mergeNewestFirst(recent.transactions, older, limit), complete: true };
    }
    catch {
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
function asJson(value) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        const out = [];
        for (const item of value) {
            const json = asJson(item);
            if (json === undefined)
                return undefined;
            out.push(json);
        }
        return out;
    }
    if (typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            const json = asJson(item);
            if (json === undefined)
                return undefined;
            out[key] = json;
        }
        return out;
    }
    return undefined;
}
const objectAt = (json) => json !== null && typeof json === "object" && !Array.isArray(json) ? json : undefined;
const QUERY = `query ($address: SuiAddress!, $last: Int!) {
  transactions(last: $last, filter: { affectedAddress: $address }) {
    nodes { digest transactionJson effects { status timestamp checkpoint { sequenceNumber } balanceChangesJson } }
  }
}`;
/** One GraphQL row as the gRPC message the shared parser reads. `undefined` when its shape is off. */
function executedFromGraphql(node) {
    const effects = objectAt(node["effects"]);
    const digest = node["digest"];
    const transactionJson = objectAt(node["transactionJson"]);
    const timestamp = effects?.["timestamp"];
    const checkpoint = objectAt(effects?.["checkpoint"])?.["sequenceNumber"];
    const changes = effects?.["balanceChangesJson"];
    if (typeof digest !== "string" || transactionJson === undefined || effects === undefined)
        return undefined;
    const ms = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    const options = { ignoreUnknownFields: true };
    return GrpcTypes.ExecutedTransaction.create({
        digest,
        transaction: GrpcTypes.Transaction.fromJson(transactionJson, options),
        effects: GrpcTypes.TransactionEffects.create({ status: { success: effects["status"] === "SUCCESS" } }),
        ...(Number.isFinite(ms) ? { timestamp: { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 } } : {}),
        ...(typeof checkpoint === "number" ? { checkpoint: BigInt(checkpoint) } : {}),
        balanceChanges: Array.isArray(changes) ? changes.map((c) => GrpcTypes.BalanceChange.fromJson(c, options)) : [],
    });
}
/**
 * The deeper source over Sui's GraphQL service at `url`.
 *
 * ⛔ Anything but a clean answer throws — an error list, a missing page, a row of the wrong shape.
 *    The caller turns that into `complete: false`; it never becomes an empty history.
 */
export function graphqlHistory(url, fetchFn = (input, init) => fetch(input, init)) {
    return async (address, limit, signal) => {
        const res = await fetchFn(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: QUERY, variables: { address, last: limit } }),
            ...(signal === undefined ? {} : { signal }),
        });
        if (!res.ok)
            throw new Error(`The history service answered HTTP ${res.status}.`);
        const body = await res.json();
        const top = objectAt(asJson(body));
        if (top === undefined || top["errors"] !== undefined) {
            throw new Error("The history service answered with an error.");
        }
        const nodes = objectAt(objectAt(top["data"])?.["transactions"])?.["nodes"];
        if (!Array.isArray(nodes))
            throw new Error("The history service answered without a list.");
        const rows = [];
        // `last: n` arrives oldest-first; the list here is newest-first.
        for (const node of [...nodes].reverse()) {
            const row = objectAt(node);
            const executed = row === undefined ? undefined : executedFromGraphql(row);
            if (executed === undefined)
                throw new Error("The history service answered a row this build cannot read.");
            const parsed = parseGrpcTransactionResponse(executed, { include: { transaction: true, balanceChanges: true } });
            const tx = parsed.Transaction ?? parsed.FailedTransaction;
            if (tx !== undefined)
                rows.push(tx);
        }
        return rows;
    };
}

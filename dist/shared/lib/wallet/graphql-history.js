// The deeper source of `address-history.ts`: a wallet's history from Sui's public GraphQL services,
// for what a gRPC node no longer keeps or could not give. ⚠ PUBLISHED — copied byte-for-byte into
// the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ Its rows are read by the SAME parser as the node's: GraphQL's `transactionJson` and
//    `balanceChangesJson` are the gRPC messages written as JSON, so one row means one thing whichever
//    service gave it.
import { GrpcTypes, parseGrpcTransactionResponse } from "@mysten/sui/grpc";
/**
 * Sui's public GraphQL services per network, in the order they are asked. Measured 2026-10-21 for
 * Mysten Labs: the `affectedAddress` filter answered back to 2023 on both networks, in 0.2–0.9 s,
 * with `access-control-allow-origin: *`.
 *
 * ⭐ A SECOND OPERATOR ON MAINNET (2026-11-09). Until then Mysten Labs was the only one and a
 *   failure there left every wallet's older history unread. 01NODE Funding SRL (Bucharest, Romania,
 *   its own network) runs a public mainnet GraphQL at `sui.01.ro`; measured that day from this machine:
 *   the same query and the same rows as Mysten's (the treasury's oldest transaction, 2026-08-02),
 *   checkpoints back to 2023, `access-control-allow-origin: *`, 1.3 s. Testnet keeps one
 *   operator: development has no second public GraphQL and no one's activity depends on it.
 * ⭐ NO THIRD (2026-11-10, D51). Triton One Limited's `mainnet.sui.rpcpool.com/graphql` answered this
 *   file's exact query from real Chromium on an `https://nmts.me` page, with CORS and the same first
 *   rows, but Triton's documentation calls that endpoint "for development and evaluation only, not
 *   production traffic" and strictly rate limited: the day Mysten and 01NODE fail it would carry
 *   every wallet and refuse them. Suiscan, SuiVision, PublicNode, Ankr, Tatum, Pocket, BlockPI and
 *   Nodeinfra did not answer it (no service, no CORS, 403, an error body, 500, 404, nothing in 15 s).
 * Still the second tier and never the only one: when every service fails the answer is
 * `complete: false`, never "nothing there".
 */
export const SUI_GRAPHQL_URLS = {
    mainnet: ["https://graphql.mainnet.sui.io/graphql", "https://sui.01.ro/graphql"],
    testnet: ["https://graphql.testnet.sui.io/graphql"],
};
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
 * The deeper source over Sui's GraphQL services at `urls`, asked in order until one answers cleanly.
 *
 * ⛔ Anything but a clean answer from a service moves to the next — an error list, a missing page, a
 *    row of the wrong shape, no connection; when none answers it throws. The caller turns that into
 *    `complete: false`; it never becomes an empty history. A call the caller aborted is not retried.
 */
export function graphqlHistory(urls, fetchFn = (input, init) => fetch(input, init)) {
    const list = typeof urls === "string" ? [urls] : urls;
    return async (address, limit, signal) => {
        let last = new Error("No history service is configured.");
        for (const url of list) {
            try {
                return await graphqlRows(url, fetchFn, address, limit, signal);
            }
            catch (e) {
                if (signal?.aborted === true)
                    throw e;
                last = e;
            }
        }
        throw last;
    };
}
/** One GraphQL service's newest `limit` rows for `address`, newest first; throws on anything unclean. */
async function graphqlRows(url, fetchFn, address, limit, signal) {
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
}

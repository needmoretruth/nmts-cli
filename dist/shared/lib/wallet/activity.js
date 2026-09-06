// The wallet's activity list — one pure judgement per transaction. ⚠ PUBLISHED — copied
// byte-for-byte into the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ THE ONE RULE THIS FILE KEEPS: NO NAME OF OURS ON A TRANSACTION WE ARE NOT SURE OF. The chain
//    gives a digest, a time and balance changes — not our words "upload" or "exchange". Writing
//    "upload" on a "probably an upload" is a lie to the person, and the worst kind: they came here
//    to find out why the balance went down.
//    ▶ So a name is put only where a constant we already hold PROVES it, and the rest is "other"
//      — still shown with its time, its balance changes and its chain link. Not knowing is written
//      as not knowing, never drawn as nothing having happened.
//
// ⭐ What proves each name (every one a measured constant, none a guess):
//   · storage network — the transaction's inputs carry the Walrus SYSTEM object (an id the SDK
//     publishes per network) and a Move call's module is `system`. The function then decides:
//     `register_blob` / `certify_blob` → seal · `extend_blob` → extend · `delete_blob` → erase.
//     (Function names read verbatim from `@mysten/walrus`'s generated contract bindings, 2026-08-17.)
//   · exchange — a Move call's package is DeepBook or Bluefin, or the inputs carry the testnet
//     exchange object.
//   · donate — a transaction in which one of our donation addresses GAINED balance.
//   · send / receive — a pure transfer with no Move call; our balance down = send, up = receive.
//   · anything else → no name.
//
// ⚠ What this judgement cannot do:
//   · a transaction that does several things gets the FIRST name that matches (the order below is
//     the answer);
//   · a Walrus package upgrade keeps the system object id, so this survives one; the day the
//     system object itself changes, storage transactions quietly become "other" — a missing name,
//     never a wrong one;
//   · the list is what the CHAIN knows. Whether a storage node still holds the bytes is not
//     proved here.
//
// ⛔ NO CONSTANT IS IMPORTED. Everything the judgement compares against arrives in
//    `ActivityContext`, so the same file serves the browser (which reads its build's network) and
//    the command-line tool (which resolves the network at run time) without a fork.
// ── Small readers ─────────────────────────────────────────────────────────────────────────────
/** The address out of `{ AddressOwner: "0x…" }`. Other owner shapes (shared, immutable) have none → `null`. */
function ownerAddress(owner) {
    if (typeof owner !== "object" || owner === null)
        return null;
    if (!("AddressOwner" in owner))
        return null;
    const value = owner.AddressOwner;
    return typeof value === "string" ? value : null;
}
/** The RPC gives the time as a string. Unreadable ⇒ `null`, NEVER an invented number. */
function readTimestamp(raw) {
    if (raw === null || raw === undefined)
        return null;
    const value = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}
/**
 * Put an address into one shape before comparing.
 *
 * ⚠ A Sui address can be written zero-padded or not (`0x2` and `0x000…02` are the same one). The
 *   RPC's form and the one in our configuration can differ, and then THE SAME ADDRESS COMPARES AS
 *   DIFFERENT — a gift would fall through to "send". So both are padded to 32 bytes first.
 */
export function normalizeAddress(raw) {
    const body = raw.trim().toLowerCase().replace(/^0x/, "");
    if (body === "" || !/^[0-9a-f]+$/.test(body) || body.length > 64)
        return raw.trim().toLowerCase();
    return `0x${body.padStart(64, "0")}`;
}
/** Every Move call (empty for a pure transfer). */
function moveCalls(tx) {
    const commands = tx.transaction?.data?.transaction?.transactions ?? [];
    const calls = [];
    for (const command of commands) {
        if (typeof command === "string")
            continue;
        if (command.MoveCall !== undefined)
            calls.push(command.MoveCall);
    }
    return calls;
}
/** Every object id among the inputs, zero-padded. */
function inputObjectIds(tx) {
    const ids = new Set();
    for (const input of tx.transaction?.data?.transaction?.inputs ?? []) {
        if (typeof input.objectId === "string")
            ids.add(normalizeAddress(input.objectId));
    }
    return ids;
}
/** The functions of the Walrus `system` module whose names we know → our kind. */
const WALRUS_FUNCTION_KIND = {
    register_blob: "seal",
    certify_blob: "seal",
    extend_blob: "extend",
    delete_blob: "erase",
};
/**
 * One transaction → one row for a screen or a terminal.
 *
 * ⛔ THE ORDER OF THE JUDGEMENT IS THE ANSWER — a transaction matching several branches gets the
 *    first: ① storage network (system object + a known `system` function) ② exchange ③ donation
 *    ④ send / receive ⑤ other. Storage comes first because it is the commonest reason a balance
 *    here goes down; donation comes before send because a more specific truth beats a less
 *    specific one.
 */
export function toActivityRow(tx, ctx) {
    const me = normalizeAddress(ctx.address);
    const digest = typeof tx.digest === "string" ? tx.digest : "";
    const sender = normalizeAddress(tx.transaction?.data?.sender ?? "");
    const gasOwnerRaw = tx.transaction?.data?.gasData?.owner;
    const gasOwner = typeof gasOwnerRaw === "string" ? normalizeAddress(gasOwnerRaw) : sender;
    const pool = ctx.poolAddress === "" ? null : normalizeAddress(ctx.poolAddress);
    const gasPayer = gasOwner === sender ? "self" : pool !== null && gasOwner === pool ? "pool" : "other";
    const changes = [];
    let donationGain = false;
    for (const change of tx.balanceChanges ?? []) {
        const owner = ownerAddress(change.owner);
        if (owner === null)
            continue;
        const normalized = normalizeAddress(owner);
        const amount = BigInt(change.amount ?? "0");
        if (normalized === me) {
            const coinType = change.coinType ?? "";
            changes.push({
                coin: coinType === ctx.walCoinType ? "WAL" : coinType === "0x2::sui::SUI" ? "SUI" : null,
                coinType,
                amount,
            });
            continue;
        }
        if (amount > 0n && ctx.donationAddresses.some((a) => a !== "" && normalizeAddress(a) === normalized)) {
            donationGain = true;
        }
    }
    const calls = moveCalls(tx);
    const inputs = inputObjectIds(tx);
    const walrusSystem = normalizeAddress(ctx.walrusSystemObjectId);
    let kind = "other";
    const walrusCall = inputs.has(walrusSystem)
        ? calls.find((c) => c.module === "system" && (c.function ?? "") in WALRUS_FUNCTION_KIND)
        : undefined;
    if (walrusCall !== undefined) {
        kind = WALRUS_FUNCTION_KIND[walrusCall.function ?? ""] ?? "other";
    }
    else if (calls.some((c) => typeof c.package === "string" &&
        ((ctx.deepbookPackageId !== null &&
            normalizeAddress(c.package) === normalizeAddress(ctx.deepbookPackageId)) ||
            (ctx.bluefinPackageId !== null &&
                normalizeAddress(c.package) === normalizeAddress(ctx.bluefinPackageId)))) ||
        (ctx.exchangeObjectId !== null && inputs.has(normalizeAddress(ctx.exchangeObjectId)))) {
        kind = "exchange";
    }
    else if (donationGain && sender === me) {
        kind = "donate";
    }
    else if (calls.length === 0 && changes.length > 0) {
        const net = changes.reduce((sum, c) => sum + c.amount, 0n);
        if (sender === me && net < 0n)
            kind = "send";
        else if (sender !== me && net > 0n)
            kind = "receive";
    }
    return {
        digest,
        atMs: readTimestamp(tx.timestampMs),
        failed: (tx.effects?.status?.status ?? "success") !== "success",
        gasPayer,
        kind,
        changes,
        explorerUrl: explorerTxUrl(digest, ctx.network),
    };
}
/**
 * Where a person can look the transaction up themselves.
 *
 * ⚠ A plain navigation link (not a fetch, so no `connect-src` concern). The same explorer's object
 *   links are already used elsewhere in the product, in the same shape.
 * ⭐ The URL shape was CHECKED IN A REAL BROWSER (2026-08-17): opening it shows that digest.
 *   ⛔ It cannot be checked with `curl` — the site renders in the browser, the fetched HTML is
 *   empty, and EVERY path answers 200.
 */
export function explorerTxUrl(digest, network) {
    return `https://suiscan.xyz/${network}/tx/${digest}`;
}
/**
 * The two lists (sent, received) folded into one.
 *
 * ⛔ THE RPC FILTER HAS NO OR — `FromAddress` and `ToAddress` cannot be asked for together, so
 *    they are asked for twice and merged here. A transaction can appear on both sides, so
 *    DUPLICATES ARE REMOVED BY DIGEST.
 * ⚠ Rows with no time go LAST — treating a missing time as 0 would float "1970" to the top.
 */
export function mergeActivity(groups, limit) {
    const byDigest = new Map();
    for (const group of groups) {
        for (const row of group) {
            if (row.digest !== "" && !byDigest.has(row.digest))
                byDigest.set(row.digest, row);
        }
    }
    return [...byDigest.values()]
        .sort((a, b) => {
        if (a.atMs === b.atMs)
            return 0;
        if (a.atMs === null)
            return 1;
        if (b.atMs === null)
            return -1;
        return b.atMs - a.atMs;
    })
        .slice(0, limit);
}

/**
 * Run `transaction` without signing, checks off, and return what each command returned.
 *
 * `sender` is set only when the transaction has none — a devInspect needs one, and nothing is spent:
 * with checks off and no gas payment the node simulates with a mocked gas coin.
 *
 * ⛔ A refusal the node REPORTS (the Move call aborted) comes back as `error`; a request the node
 * could not run at all (no such object, malformed call) throws, as the old call's RPC errors did.
 */
export async function inspect(client, transaction, sender) {
    transaction.setSenderIfNotSet(sender);
    const res = await client.core.simulateTransaction({
        transaction,
        checksEnabled: false,
        include: { commandResults: true },
    });
    if (res.$kind === "FailedTransaction") {
        return { error: res.FailedTransaction.status.error?.message ?? "the calls did not run", results: [] };
    }
    return {
        error: null,
        results: (res.commandResults ?? []).map((r) => ({ returnValues: r.returnValues.map((v) => v.bcs) })),
    };
}
/**
 * Simulate built transaction bytes exactly as they would be submitted (checks on, gas as built).
 *
 * Nothing is signed, nothing is broadcast. Throws when the node returns no effects, because a dry run
 * without a gas figure is not an answer any caller can use.
 */
export async function dryRun(client, bytes) {
    const res = await client.core.simulateTransaction({ transaction: bytes, include: { effects: true } });
    const tx = res.Transaction ?? res.FailedTransaction;
    const effects = tx?.effects;
    if (tx === undefined || effects === undefined || effects === null) {
        throw new Error("The dry run came back without effects.");
    }
    return { status: tx.status, gasUsed: effects.gasUsed };
}
/** A u64 return value: exactly eight little-endian bytes, or a refusal to guess. */
export function u64FromLe(bytes) {
    if (bytes === undefined || bytes.length !== 8) {
        throw new Error("The chain answered a number in an unexpected shape.");
    }
    return bytes.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}
/**
 * An object's Move fields as JSON, or `null` when the node rendered none. An object that does not
 * exist (deleted, wrapped, or on another network) THROWS — the core API's `getObject` refuses rather
 * than answering empty, and a caller that must tell "gone" from "unreadable" catches it.
 *
 * ⚠ The JSON form is the node's rendering of the struct; the SDK warns that its exact field shapes
 * may differ between transports. Callers here read top-level primitive fields (a package id, a
 * number) only, which every transport renders the same way.
 */
export async function objectFields(client, objectId) {
    const { object } = await client.core.getObject({ objectId, include: { json: true } });
    return object.json ?? null;
}

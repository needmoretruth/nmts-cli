// What the chain says about one executed transaction — read ONE way for every signer in this tool.
//
// ⛔ WHY ONE READER (2026-10-21). Sui retired JSON-RPC, whose execute answer carried the status as a
//    word (`effects.status.status === "failure"`) and the created objects as `objectChanges`. The gRPC
//    answer carries `status.success` and `effects.changedObjects` plus a separate `objectTypes` map.
//    Six signers in `wallet-sign.ts` and two in `wallet-sign-external.ts` each read the old shape by
//    hand; one translation here is what keeps "executed and FAILED" from being misread in one of them.
//
// ⛔ A DIGEST IS NOT A SUCCESS. A transaction that executed and failed still has a digest, and its
//    gas is gone. `refused` is the chain's reason in that case and `null` only when it went through.
/** What every execution asks the node to include: the effects (status, objects) and the objects' types. */
export const EXECUTE_INCLUDE = { effects: true, objectTypes: true };
/** Read one answer. Throws when it carries no transaction at all — that is not an answer to judge. */
export function readAnswer(answer) {
    const tx = answer.Transaction ?? answer.FailedTransaction;
    if (tx === undefined)
        throw new Error("The chain answered without the transaction it was asked about.");
    const reason = tx.status.error?.message;
    const refused = tx.status.success ? null : reason !== undefined && reason !== "" ? reason : "no reason was given";
    const created = (tx.effects?.changedObjects ?? [])
        .filter((change) => change.idOperation === "Created")
        .map((change) => ({ objectId: change.objectId, type: tx.objectTypes?.[change.objectId] ?? null }));
    return { digest: tx.digest, refused, created };
}
/**
 * Sign `transaction` with `signer`, execute it once, and read the answer.
 *
 * ⛔ THE WAIT AFTER A SUCCESS is for what happens NEXT — the server told the digest, `nmts wallet`
 *    run, the browser's activity list opened — because a node that has not indexed the transaction
 *    yet answers those as if nothing happened. A wait that times out changes nothing about what was
 *    signed, so it is not an error of the transaction.
 *
 * ⚠ A THROW HERE IS NOT PROOF THAT NOTHING HAPPENED: a timeout or a dropped connection after the
 *   bytes went out says nothing about whether the transaction executed.
 */
export async function signAndRun(client, transaction, signer) {
    const answer = await client.core.signAndExecuteTransaction({ transaction, signer, include: EXECUTE_INCLUDE });
    const executed = readAnswer(answer);
    if (executed.refused === null) {
        await client.core.waitForTransaction({ digest: executed.digest }).catch(() => undefined);
    }
    return executed;
}

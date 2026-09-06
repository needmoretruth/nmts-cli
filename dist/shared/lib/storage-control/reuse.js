// Registering a new blob into a storage resource the wallet ALREADY holds — the place where
// "put it in that space" is expressed as a transaction. ⚠ PUBLISHED — copied byte-for-byte into
// the `nmts` command-line package; keep comments self-contained English.
//
// ⛔ WHY THE SDK IS NOT USED HERE. `client.registerBlob` hard-codes `storage: this.createStorage(…)`
//    — it always BUYS. There is no slot for a resource one already owns. The Move function takes
//    that slot as an argument (`register_blob(self, storage, blobId, rootHash, size, encodingType,
//    deletable, writePayment)`), and the SDK offers no path to it.
//
// ⛔ THE GENERATED MOVE BINDINGS CANNOT BE USED EITHER. `@mysten/walrus/dist/contracts/walrus/
//    system.mjs` is a path the package does not export; importing it is refused with
//    `ERR_PACKAGE_PATH_NOT_EXPORTED` (measured 2026-08-28). So the `moveCall` is written by hand,
//    which is the right thing anyway: leaning on somebody's internal path breaks silently on their
//    next version.
//
// ⛔ THE WRITE-PAYMENT COIN GOES IN BY REFERENCE. Move takes what it needs out of it and THE EMPTY
//    SHELL IS THE CALLER'S TO DESTROY. Left alone, the transaction never reaches the chain: it is
//    refused at assembly with `UnusedValueWithoutDrop` — which happened once, for real.
//
// ⭐ THIS FILE BUILDS TRANSACTIONS AND NOTHING ELSE. "May this resource be used" is answered by the
//    pure judgement below, and the final verdict is a DRY RUN (if the chain refuses, no value
//    leaves).
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
/**
 * Only "it certainly fits" is true.
 *
 * ⛔ THE ENCODED LENGTH IS NOT COMPUTED HERE. That arithmetic is the protocol's and lives inside
 *    the SDK (unexported); a copy kept here would be wrong the day they change it, and only we
 *    would not know. ▶ Instead MONOTONICITY alone is used: the encoded length never shrinks as the
 *    raw length grows, so a new file no larger than the one the resource held certainly fits.
 * ⚠ This is therefore a SUFFICIENT condition. When it is false the real answer comes from a dry
 *   run — resources carry a 63 MiB floor, so a slightly larger file fitting a small file's slot
 *   is common in practice.
 */
export function surelyFits(input) {
    if (input.resourceEndEpoch <= input.currentEpoch)
        return false;
    if (input.heldRawBytes === undefined)
        return false;
    return input.newRawBytes <= input.heldRawBytes;
}
/** A registration that uses ONE held storage resource as it is. */
export function registerIntoStorage(input, transaction) {
    const tx = transaction ?? new Transaction();
    tx.setSenderIfNotSet(input.owner);
    const writeCoin = tx.add(coinWithBalance({ balance: input.writeCost, type: input.walType }));
    const blob = tx.moveCall({
        package: input.walrusPackageId,
        module: "system",
        function: "register_blob",
        arguments: [
            tx.object(input.systemObjectId),
            tx.object(input.storageObjectId),
            tx.pure.u256(input.blobIdAsInt),
            tx.pure.u256(BigInt(bcs.u256().parse(input.rootHash))),
            tx.pure.u64(input.rawBytes),
            // 1 = RS2. ⚠ Must equal what the SDK registers with — otherwise the storage nodes wait for
            // a different encoding.
            tx.pure.u8(1),
            tx.pure.bool(input.deletable),
            writeCoin,
        ],
    });
    // ⛔ The place the header comment is about. Not destroyed = refused at assembly.
    tx.moveCall({ target: "0x2::coin::destroy_zero", typeArguments: [input.walType], arguments: [writeCoin] });
    tx.transferObjects([blob], input.owner);
    return tx;
}
/**
 * "Cut to fit": shrink a held resource to exactly what the file needs, so the rest stays a free
 * resource instead of being bound inside the blob. The owner's rule: the person chooses between
 * cutting and binding whole, and is shown the leftover in bytes — no default is chosen for them.
 *
 * ⛔ WHICH HALF IS WHICH IS THE CONTRACT'S CHOICE, read from `storage_resource.move`: `split_by_size`
 *    MODIFIES the given resource down to `split_size` and RETURNS a new object holding the rest.
 *    So the object id the caller already holds is the one that registers the blob afterwards, and
 *    the returned object is the leftover — which must be transferred, or the transaction is
 *    refused at assembly for an unused value.
 *
 * ⚠ `keepBytes` must be the ENCODED size (the chain's `encoded_blob_length`), never the raw one:
 *   registration checks `encoded_size <= storage_size` and a resource cut to the raw size fails it.
 */
export function splitStorageToFit(input, transaction) {
    const tx = transaction ?? new Transaction();
    tx.setSenderIfNotSet(input.owner);
    const rest = tx.moveCall({
        package: input.walrusPackageId,
        module: "storage_resource",
        function: "split_by_size",
        arguments: [tx.object(input.storageObjectId), tx.pure.u64(input.keepBytes)],
    });
    tx.transferObjects([rest], input.owner);
    return tx;
}

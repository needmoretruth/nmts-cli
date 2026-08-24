// The two steps after the money has moved: get the bytes onto the network, and make the file real.
//
// ⛔ SPLIT OUT OF `upload.ts` SO THAT FILE STAYS READABLE IN ONE SITTING. It is the file that
//    decides what gets bought; these are the steps it drives afterwards, and both of them run in a
//    world where the account has ALREADY PAID. Every failure message below therefore has to say so
//    — "try again" is honest advice before the reserve and misleading after it.
import { readItemRecord, writeItemRecord } from "./upload-store.js";
import { UploadError, } from "./upload-wire.js";
/** ITEM PARTS: the storage shape this tool writes — one blob per part, the file its own set. */
const STORAGE_KIND_DEDICATED_BLOB = 0;
/** Walrus. The only network with an upload path. */
const NETWORK_WALRUS = 0;
/** Only this account can read it. Sharing is a separate act, made in a browser. */
const VISIBILITY_PERSONAL = 0;
function why(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Push ONE part's bytes at the relay and report the certificate. Commits nothing. */
export async function pushPart(input, step) {
    input.onStep?.({ step: "uploading", relayUrl: step.relayUrl, bytes: step.sealed.length });
    let certificate;
    try {
        certificate = await input.protocol.uploadToRelay({
            blobId: step.blobId,
            bytes: step.sealed,
            nonce: step.nonce,
            registerTxDigest: step.registerTxDigest,
            blobObjectId: step.blobObjectId,
        });
    }
    catch (error) {
        throw new UploadError({
            phase: "uploading",
            message: `Uploading to the storage network failed: ${why(error)}`,
            paid: true,
            nextStep: "The storage is already bought. Running the same command again pushes the same bytes to " +
                "the same relay and costs nothing more.",
        });
    }
    input.onStep?.({ step: "certifying" });
    try {
        await input.api.uploaded(step.ledgerId, certificate);
    }
    catch (error) {
        throw new UploadError({
            phase: "certify",
            message: why(error),
            paid: true,
            nextStep: "The bytes are on the network. Certifying moves no money, so running the same command " +
                "again simply finishes the job.",
        });
    }
}
/**
 * Make the file real: one `POST /v1/items` naming EVERY part and the reservation that paid for it.
 *
 * ⛔ ONE CALL FOR THE WHOLE FILE. The server derives the item's size as the sum of the parts'
 *    sealed lengths and refuses a set whose indices are not a contiguous 0..n — so a file cannot
 *    be committed a piece at a time, and a part left out is not a smaller file, it is a rejection.
 *
 * ⛔ EVERY FACT HERE COMES OFF A RECORD. The parts were read back from what was written down
 *    before each reservation; the key and the content hash come from whichever record the caller
 *    read them from. A resumed run that used its own freshly generated key would produce a file
 *    that is paid for, present, correctly named — and impossible to open.
 */
export async function commitItem(input, fileKey, parts) {
    input.onStep?.({ step: "committing" });
    // Advisory only — the chain is the authority on a blob's life. 0 when this machine could not
    // read the epoch clock: a number we do not have is not a number to invent.
    const expiryEpoch = input.currentEpoch === null ? 0 : input.currentEpoch + input.epochs;
    const previous = readItemRecord(fileKey);
    // ⛔ ALREADY COMMITTED IS NOT COMMITTED AGAIN. The record outlives the commit precisely so a run
    //    that died before writing the file list does not make a second file out of storage that is
    //    already named.
    if (previous?.itemId !== undefined)
        return previous.itemId;
    const attempt = previous?.attempt ?? 0;
    writeItemRecord(fileKey, { attempt });
    let view;
    try {
        view = await input.api.createItem({
            size: parts.reduce((sum, part) => sum + part.sealedLen, 0),
            dek_wrapped: input.entry.dekWrapped,
            content_hash_ct: input.entry.contentHashCt,
            visibility: VISIBILITY_PERSONAL,
            parts: parts.map((part) => ({
                part_index: part.partIndex,
                storage_kind: STORAGE_KIND_DEDICATED_BLOB,
                network: NETWORK_WALRUS,
                blob_id: part.blobId,
                sealed_len: part.sealedLen,
                expiry_epoch: expiryEpoch,
                sponsored_ledger_id: part.ledgerId,
            })),
        }, `nmts-cli-commit-${fileKey}-${attempt}`);
    }
    catch (error) {
        throw new UploadError({
            phase: "committing",
            message: `The file is stored but saving it to the drive failed: ${why(error)}`,
            paid: true,
            nextStep: "Nothing more will be spent. Running the same command again commits the same stored " +
                "bytes — the retry is recognised and does not make a second file.",
        });
    }
    // ⛔ Written down before returning: from here on the file EXISTS and is paid for, and the only
    //    thing still missing is the account's own list. Losing the record now would make it
    //    unreachable.
    writeItemRecord(fileKey, { attempt, itemId: view.id });
    return view.id;
}

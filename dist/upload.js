// The credit-paid upload, end to end, for ONE file.
//
// ⛔ THIS IS THE ONLY PATH IN THIS TOOL THAT SPENDS. Everything else reads. The order of the steps
//    below is not a style choice — it is what stands between an interruption and money that bought
//    nothing:
//
//      seal → encode → WRITE IT DOWN → reserve (credits move here) → write it down again
//           → relay → certify        … once per part …
//      → commit the file (every part named at once) → write the file list → forget the records
//
//    The two writes bracket the spend. Before it, so a retry has the sealed bytes and the tip
//    nonce that reproduce the blob the reservation bought. After it, so the transaction the relay
//    checks its tip in is not lost with the process.
//
// ⛔ A RESUME READS THE RECORD AND NOT THE CALLER. Sealing is non-deterministic, so a run that
//    re-sealed and then resumed would push bytes that are not the blob the treasury registered —
//    the relay refuses them, forever, and the credits are gone. Everything the reservation bought
//    is a function of ONE PARTICULAR SEALING of the file: the blob id, the wrapped file key, the
//    content hash, the relay that was tipped. All of it comes back out of the record.
//
// ⛔ NO WALLET IS TOUCHED AND NOTHING IS SIGNED HERE. The treasury pays for the storage against
//    credits the account already holds; this tool encodes bytes, asks the server to buy, pushes
//    the bytes at the relay and reports what the storage nodes signed. There is no signer in this
//    file and no transaction is built.
//
// ⛔ EVERY SEAM IS INJECTED. The storage-network protocol and the api are interfaces, so the tests
//    drive the real decisions — including every failure branch — without a network and without
//    spending anything. The seams themselves are in `upload-wire.ts`.
import { NmtsError } from "./errors.js";
import { ServerError } from "./api.js";
import { readReservationBytes, readReservationRecord, writeReservation, } from "./upload-store.js";
import { pushPart } from "./upload-steps.js";
import { UploadError, } from "./upload-wire.js";
export * from "./upload-wire.js";
/** A reservation state that can still become storage. Anything else is dead. */
function isLive(state) {
    return state === "registered" || state === "certified";
}
function why(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Buy storage for ONE PART, put its bytes on the network, and stop there.
 *
 * ⛔ IT DOES NOT MAKE A FILE. Committing is one act for the whole file — `commitItem` names every
 *    part at once — and a part that returns from here is bought, filled and certified storage that
 *    nothing in the account can see yet. Splitting it this way is what lets a file be larger than
 *    memory: the parts are bought one at a time, each written down before its own money moves.
 *
 * ⛔ IT DOES NOT WRITE THE FILE LIST either. That is the caller's step, and it must happen before
 *    the records are cleared — a committed file the list does not name is invisible and, to the
 *    person, indistinguishable from one that never uploaded.
 */
export async function buyAndPushPart(input) {
    const { api, protocol, key, sealed, onStep } = input;
    const existing = readReservationRecord(key);
    // ⛔ THE STORED PLACEMENT WINS THE ARGUMENT, AND A DISAGREEMENT STOPS THE RUN. The bytes on disk
    //    were sealed as part i of n and paid for as that; pushing them while this run believes the
    //    file splits some other way would file storage under the wrong position in the file. It
    //    happens for one ordinary reason — the same file put again with a different part size — so
    //    it is said plainly rather than left to fail later as an unreadable download.
    if (existing !== null) {
        const record = existing;
        if (record.partIndex !== input.part.index || record.partTotal !== input.part.total) {
            throw new UploadError({
                phase: "reserve",
                message: `This upload was started as part ${record.partIndex + 1} of ${record.partTotal} and this ` +
                    `run is treating it as part ${input.part.index + 1} of ${input.part.total}.`,
                paid: record.ledgerId !== undefined,
                nextStep: "Run it again with the part size the first attempt used, or move the records in the " +
                    "uploads directory aside to start over. Nothing was sent.",
            });
        }
    }
    // ── the credits already moved: ask where the reservation stands before doing anything ──
    if (existing?.ledgerId !== undefined) {
        const record = existing;
        const ledgerId = record.ledgerId;
        if (ledgerId === undefined)
            throw new NmtsError("unreachable: a record with no ledger id");
        let status;
        try {
            status = await api.status(ledgerId);
        }
        catch (error) {
            throw new UploadError({
                phase: "reserve",
                message: `Could not ask about the paid reservation ${ledgerId}: ${why(error)}`,
                paid: true,
                nextStep: "Nothing more was spent. The storage this account paid for is still bought — run the " +
                    "same command again when the server answers.",
            });
        }
        onStep?.({ step: "resuming", ledgerId, state: status.state });
        if (status.state === "certified") {
            return paidPart(record, ledgerId, true);
        }
        if (!isLive(status.state)) {
            // ⛔ THE RECORD IS KEPT AND ITS ATTEMPT NUMBER GOES UP. Deleting it looks tidier and is the
            //    trap: the idempotency key is derived from a key that is a pure function of the account,
            //    the bytes and the destination, and the server replays a reservation row under its key
            //    whatever state it is in — `failed` included. A cleared record means the next run
            //    rebuilds the same key, is handed the same dead row, and is told to start over into it.
            //    Forever. Counting up is what starting over actually means.
            writeReservation(key, { ...stripReservation(record), attempt: record.attempt + 1 }, readReservationBytes(key));
            throw new UploadError({
                phase: "reserve",
                message: `The credit reservation for this file ended as "${status.state}" and cannot be used.`,
                paid: true,
                nextStep: "Running the same command again asks for a NEW reservation, which will spend credits. " +
                    "Nothing was uploaded under the one that failed.",
            });
        }
        if (!status.register_tx_digest || !status.blob_object_id) {
            throw new UploadError({
                phase: "reserve",
                message: `Reservation ${ledgerId} is registered but the server did not say which blob it bought.`,
                paid: true,
                nextStep: "Nothing was uploaded and nothing more was spent.",
            });
        }
        await pushPart(input, {
            ledgerId,
            blobId: record.blobId,
            nonce: Buffer.from(record.nonceB64, "base64url"),
            registerTxDigest: status.register_tx_digest,
            blobObjectId: status.blob_object_id,
            // ⛔ THE STORED BYTES AND THE STORED RELAY. Not the caller's — see the module header.
            //    Read here, and only here: a part that came back certified never needs them at all.
            sealed: readReservationBytes(key),
            relayUrl: record.relayUrl,
        });
        return paidPart(record, ledgerId, true);
    }
    // ── fresh, or interrupted before the money moved ──
    onStep?.({ step: "encoding", bytes: sealed.length });
    let meta;
    try {
        meta = await protocol.computeMetadata({
            bytes: sealed,
            // Re-feeding a stored nonce is what makes the retry reproduce the digest a paid tip was
            // computed for. A fresh random one would strand the reservation.
            nonce: existing ? new Uint8Array(Buffer.from(existing.nonceB64, "base64url")) : undefined,
        });
    }
    catch (error) {
        throw new UploadError({
            phase: "encoding",
            message: `Could not prepare this file for the storage network: ${why(error)}`,
            paid: false,
            nextStep: "Nothing was sent and nothing was spent.",
        });
    }
    const nonceB64 = Buffer.from(meta.nonce).toString("base64url");
    const record = {
        // ⛔ The attempt number is CARRIED FORWARD, not reset. A record that survives a dead
        //    reservation is exactly the case that needs a different idempotency key.
        attempt: existing?.attempt ?? 0,
        blobId: meta.blobId,
        nonceB64,
        rootHashB64: Buffer.from(meta.rootHash).toString("base64url"),
        relayUrl: input.relayUrl,
        epochs: input.epochs,
        sealedLen: sealed.length,
        plaintextLen: input.entry.plaintextLen,
        partPlaintextLen: input.part.plaintextLen,
        partIndex: input.part.index,
        partTotal: input.part.total,
        dekWrapped: input.entry.dekWrapped,
        contentHashCt: input.entry.contentHashCt,
        name: input.entry.name,
        parentId: input.entry.parentId,
    };
    // ⛔ BEFORE THE MONEY. See the module header.
    writeReservation(key, record, sealed);
    onStep?.({ step: "reserving" });
    let reply;
    try {
        reply = await api.reserve({
            idempotency_key: idempotencyKey(key, record.attempt),
            blob_id: meta.blobId,
            root_hash_b64: record.rootHashB64,
            // One number, measured: what the treasury is asked to buy and what the credits are charged
            // on are the same sealed bytes.
            size: sealed.length,
            epochs: input.epochs,
            relay: {
                host: input.relayUrl,
                blob_digest_b64: Buffer.from(meta.blobDigest).toString("base64url"),
                nonce_b64: nonceB64,
            },
        });
    }
    catch (error) {
        throw new UploadError({
            phase: "reserve",
            message: why(error),
            // ⛔ A refusal did not spend. A request that never got an answer MIGHT have — and the record
            //    is on disk either way, so the next run asks the server instead of guessing here.
            paid: false,
            nextStep: error instanceof ServerError
                ? "Nothing was uploaded. No credits were spent on a refused reservation."
                : "If the request reached the server, credits may have been spent — running the same " +
                    "command again finds that reservation rather than making a second one.",
        });
    }
    if (!isLive(reply.state)) {
        // Same reason as the resumed branch above: keep the record, count up, so the next run does not
        // ask under a key the server has already settled.
        writeReservation(key, { ...stripReservation(record), attempt: record.attempt + 1 }, sealed);
        throw new UploadError({
            phase: "reserve",
            message: `The reservation came back as "${reply.state}", which cannot become storage.`,
            paid: reply.credits_spent > 0,
            nextStep: "Nothing was uploaded.",
        });
    }
    record.ledgerId = reply.ledger_id;
    if (reply.register_tx_digest)
        record.registerTxDigest = reply.register_tx_digest;
    if (reply.blob_object_id)
        record.blobObjectId = reply.blob_object_id;
    writeReservation(key, record, sealed);
    if (reply.state === "certified") {
        return paidPart(record, reply.ledger_id, false);
    }
    if (!reply.register_tx_digest || !reply.blob_object_id) {
        throw new UploadError({
            phase: "reserve",
            message: "The storage was bought but the reply did not say which blob it bought.",
            paid: true,
            nextStep: "Nothing was uploaded. Running the same command again asks the server again.",
        });
    }
    await pushPart(input, {
        ledgerId: reply.ledger_id,
        blobId: meta.blobId,
        nonce: meta.nonce,
        registerTxDigest: reply.register_tx_digest,
        blobObjectId: reply.blob_object_id,
        sealed,
        relayUrl: input.relayUrl,
    });
    return paidPart(record, reply.ledger_id, false);
}
/**
 * What the commit needs about a finished part — read off the RECORD, never off the run.
 *
 * ⛔ THE SAME REASON THE FILE LIST ENTRY COMES FROM THE RECORD. What is stored on the network is
 *    one particular sealing; a resumed run that named its own freshly computed blob id or length
 *    would commit a part that does not exist.
 */
function paidPart(record, ledgerId, resumed) {
    return {
        partIndex: record.partIndex,
        ledgerId,
        blobId: record.blobId,
        sealedLen: record.sealedLen,
        resumed,
    };
}
/**
 * The idempotency key for one attempt at one file.
 *
 * ⛔ THE ATTEMPT NUMBER IS IN IT. Without it the key is a pure function of the account, the bytes
 *    and the destination — and the server replays whatever row it has under a key, including a
 *    settled one that can never become storage.
 */
function idempotencyKey(key, attempt) {
    return `nmts-cli-${key}-${attempt}`;
}
/** What the file list must record about this upload. Always from the record, never from a run. */
export function entryOf(record) {
    return {
        name: record.name,
        parentId: record.parentId,
        plaintextLen: record.plaintextLen,
        dekWrapped: record.dekWrapped,
        contentHashCt: record.contentHashCt,
    };
}
/**
 * The record with everything the dead reservation put on it removed.
 *
 * ⛔ Explicit, not `delete`: a field left behind here is a resumed run believing it holds a
 *    transaction the relay will accept, and the failure would arrive after the money moved.
 */
function stripReservation(record) {
    const { ledgerId, registerTxDigest, blobObjectId, ...rest } = record;
    void ledgerId;
    void registerTxDigest;
    void blobObjectId;
    return rest;
}

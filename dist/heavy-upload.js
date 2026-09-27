// NMTS Heavy, paid through an ORDER — credits, or WAL from the wallet once everything is stored.
// Files in, sealed here, placed and uploaded by the shared order runner, committed as files.
//
// ⛔ THE ORDER OF THINGS IS THE SHARED RUNNER'S (`shared/lib/heavy/order-runner.ts`), byte for byte
//    the browser's: open the order, per slot seal → PieceCID → place → upload → wait until stored,
//    then pay when the wallet pays. This file supplies the edges — the sealer, the PieceCID, the
//    upload through this package's `fetch`, the api — and commits each file afterwards.
//
// ⛔ ONE KEY PER FILE, MADE ONCE AND HELD FOR THE RUN. Every part of a file is sealed under it, and it
//    is wiped on every way out. There is no resume across runs: sealing is not deterministic, so a
//    second run is a second order (the server removes an unbound order's pieces after a day and
//    gives back the credits for slots that were never stored).
//
// ⛔ THE BYTES NEVER PASS THROUGH THE SERVER. They go from this process to the storage company the
//    server named, and the company checks them against the PieceCID computed here.
//
// ⛔ NO `node:` IMPORT. The SDK's browser entry reaches this file through `portable.ts`.
import { sha256 } from "@noble/hashes/sha2.js";
import { NmtsError } from "./errors.js";
import { commitHeavyItem, createHeavyApi } from "./heavy-api.js";
import { reachFetch } from "./reach.js";
import { fileSecrets, NCF3_SHAPE, sealedLenFor, sealPart } from "./seal.js";
import { paddedPlaintextLen } from "./shared/lib/crypto/size-padding.js";
import { HEAVY_MIN_SEAL_FROM_BYTES, HEAVY_PART_SIZE_BYTES, runHeavyOrder, } from "./shared/lib/heavy/order-runner.js";
import { uploadPieceToProvider } from "./shared/lib/heavy/sp-upload.js";
import { planParts } from "./shared/lib/upload/part-plan.js";
import { padded } from "./upload-file.js";
import { CREDIT_BYTES, creditsFor } from "./upload-price.js";
/**
 * How a file is cut for Heavy: 512 MiB parts, the last one padded by the account's own rule —
 * exactly as Standard pads — and raised to the 39 bytes a legal piece needs.
 *
 * ⛔ ONLY THE LAST PART IS PADDED, for the reason `upload-file.ts` gives: a reader recovers where the
 *    padding is from the file's size, and that answer is unique only while every earlier part is full.
 */
export function planHeavyFile(size, rule) {
    if (!Number.isSafeInteger(size) || size <= 0) {
        throw new NmtsError("An empty file cannot be uploaded.", {
            nextStep: "The storage network has nothing to store and would refuse the reservation.",
        });
    }
    const plan = planParts(size, HEAVY_PART_SIZE_BYTES);
    return plan.map((range) => {
        const isLast = range.partIndex === plan.length - 1;
        const rounded = isLast
            ? paddedPlaintextLen(range.length, rule, { unitBytes: CREDIT_BYTES, shape: NCF3_SHAPE })
            : range.length;
        const sealFrom = Math.max(rounded, HEAVY_MIN_SEAL_FROM_BYTES);
        return { partIndex: range.partIndex, offset: range.offset, length: range.length, sealFrom, sealedLen: sealedLenFor(sealFrom) };
    });
}
/** What a credit-paid Heavy upload of these sizes costs: every slot is charged on its own, as the server does —
 *  half the Standard price, rounded up, at least 1 per slot — Heavy credits are priced for people, not at cost. */
export function heavyCredits(parts) {
    return parts.reduce((sum, part) => sum + Math.max(1, Math.ceil(creditsFor(part.sealedLen) / 2)), 0);
}
/** Read each file once for its content digest, and make its key. ⛔ The caller wipes `secrets.dek`. */
export async function prepareHeavyFiles(crypt, dataKey, rule, files) {
    const out = [];
    try {
        for (const file of files) {
            const plan = planHeavyFile(file.source.size, rule);
            const digest = sha256.create();
            for await (const chunk of file.source.read(0, file.source.size))
                digest.update(chunk);
            const hashed = digest.digest();
            out.push({ file, plan, secrets: fileSecrets(crypt, dataKey, hashed) });
            hashed.fill(0);
        }
        return out;
    }
    catch (error) {
        wipe(out);
        throw error;
    }
}
export function wipe(prepared) {
    for (const one of prepared)
        one.secrets.dek.fill(0);
}
/** Seal one part of a prepared file. A fresh stream, so a fresh nonce, every call. */
export function sealHeavyPart(crypt, prepared, part) {
    return sealPart(crypt, prepared.secrets.dek, padded(prepared.file.source.read(part.offset, part.length), part.length, part.sealFrom), { index: part.partIndex, total: prepared.plan.length, plaintextLen: part.sealFrom });
}
/** The PieceCID, from the Filecoin tooling's own library — loaded only now, never at start-up. */
export async function pieceCidOfBytes(bytes) {
    const { pieceCidOf } = await import("./shared/lib/heavy/piece-cid.js");
    return pieceCidOf(bytes);
}
/**
 * Upload these files as ONE Heavy order and commit each of them.
 *
 * ⛔ IT DOES NOT WRITE THE SEALED LIST — the caller does, before anything else, exactly as with
 *    `uploadFile`. A committed file the list does not name is invisible to the person.
 */
export async function heavyOrderPut(ctx, files, payment) {
    const prepared = await prepareHeavyFiles(ctx.crypt, ctx.dataKey, ctx.rule, files);
    try {
        const byKey = new Map(prepared.map((p, index) => [`f${index}`, p]));
        const seal = async (job) => {
            const one = byKey.get(job.fileKey);
            const part = one?.plan[job.partIndex];
            if (one === undefined || part === undefined)
                throw new NmtsError(`Slot ${job.slot} names no part of this upload.`);
            return sealHeavyPart(ctx.crypt, one, part);
        };
        const run = await runHeavyOrder({
            files: prepared.map((p, index) => ({
                key: `f${index}`,
                parts: p.plan.map((part) => ({ partIndex: part.partIndex, sealedLen: part.sealedLen })),
            })),
            payment,
            ...(ctx.idempotencyKey === undefined ? {} : { idempotencyKey: ctx.idempotencyKey }),
            ...(ctx.onProgress === undefined ? {} : { onProgress: ctx.onProgress }),
            ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
        }, {
            api: ctx.api ?? createHeavyApi(ctx.server, ctx.bearer),
            seal,
            pieceCid: pieceCidOfBytes,
            upload: (input) => uploadPieceToProvider({ ...input, fetchImpl: reachFetch }),
            ...ctx.deps,
        });
        const commit = ctx.commit ?? commitHeavyItem;
        const committed = [];
        for (const [index, one] of prepared.entries()) {
            const parts = run.files[index]?.parts;
            if (parts === undefined)
                throw new NmtsError(`The order came back without file ${index + 1}.`);
            const itemId = await commit({
                server: ctx.server,
                bearer: ctx.bearer,
                idempotencyKey: `nmts-heavy-${run.orderId}-${index}`,
                dekWrapped: one.secrets.dekWrapped,
                contentHashCt: one.secrets.contentHashCt,
                parts,
            });
            committed.push({
                itemId,
                name: one.file.name,
                parentId: one.file.parentId,
                destination: one.file.destination,
                plaintextLen: one.file.source.size,
                dekWrapped: one.secrets.dekWrapped,
                contentHashCt: one.secrets.contentHashCt,
                sealedBytes: one.plan.reduce((sum, part) => sum + part.sealedLen, 0),
                parts: one.plan.length,
            });
        }
        return { run, files: committed };
    }
    finally {
        wipe(prepared);
    }
}

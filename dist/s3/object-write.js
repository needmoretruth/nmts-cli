// The four ways a client changes a bucket: put a file, copy one, delete one, delete many.
//
// ⛔ WHETHER A TAKEN KEY IS A CONFLICT IS NOT DECIDED HERE. It is a question about CONTENT — is
//    the file arriving the file already there — and it cannot be answered until the bytes are in,
//    so the writer answers it, once, at the point every way of storing meets (`drive-write.ts`).
//    What reaches this layer is the outcome, and the tag of the file that was stored.
//
// ⛔ WHAT CAN BE REFUSED BEFORE THE BODY IS, IS. A key the drive cannot hold, a size over the
//    limit, a folder in the way, a condition that already fails: each is known from the request
//    line, the headers and the list, and reading gigabytes first to refuse them afterwards costs a
//    client its whole upload for an answer it could have had at once.
import { answerFor, refuse, S3Refusal, sendXml } from "./answer.js";
import { BodyRefusal, decodeBody } from "./body.js";
import { headerOf, mayTouch, metaOf, NOT_YOURS } from "./call.js";
import { checkCopySource, checkWriteCondition, copySourceConditionOf, deleteConditionOf, refuseConditions, writeConditionOf, } from "./drive-conditions.js";
import { checkKey } from "./drive-key.js";
import { checkDeclaredSize, checkNotEmpty } from "./drive-limits.js";
import { precheck } from "./drive-write.js";
import { isFolderKey, objectsOf } from "./listing.js";
import { answerAfter } from "./long-answer.js";
import { consuming, readBodyText } from "./spool.js";
import { copyObjectXml, deleteResultXml } from "./xml.js";
import { deleteAskOf, parseXml } from "./xml-read.js";
/** S3's own ceiling on a `DeleteObjects` body. */
export const MAX_DELETE_BODY = 1024 * 1024;
export async function putObject(call, writer) {
    checkKey(call.key);
    const condition = writeConditionOf(call.req, "PutObject");
    const body = decodeBody(call.req, call.verdict);
    if (body instanceof BodyRefusal)
        throw body;
    const outcome = await consuming(body, async () => {
        if (!isFolderKey(call.key)) {
            checkNotEmpty(body.size);
            checkDeclaredSize(body.size, writer.maxObjectBytes);
        }
        precheck(objectsOf(await call.source.entries()), call.key, condition);
        return await writer.put(call.key, body, metaOf(call.req), condition);
    });
    call.res.writeHead(200, { etag: outcome.etag, "content-length": "0" });
    call.res.end();
}
/** `x-amz-copy-source`: `bucket/key`, percent-encoded, with or without a leading slash. */
export function copySourceOf(header) {
    const at = header.indexOf("?");
    if (at >= 0) {
        const version = new URLSearchParams(header.slice(at + 1)).get("versionId");
        if (version !== null) {
            throw new S3Refusal(501, "NotImplemented", "This gateway keeps no versions, so a copy cannot name one.");
        }
    }
    let path;
    try {
        path = decodeURIComponent(at < 0 ? header : header.slice(0, at)).replace(/^\//, "");
    }
    catch {
        throw new S3Refusal(400, "InvalidArgument", "x-amz-copy-source is not valid percent-encoding.");
    }
    const slash = path.indexOf("/");
    if (slash <= 0 || slash === path.length - 1) {
        throw new S3Refusal(400, "InvalidArgument", "x-amz-copy-source must name a bucket and a key: bucket/key.");
    }
    return { bucket: path.slice(0, slash), key: path.slice(slash + 1) };
}
/**
 * `CopyObject`: the source's plaintext, fetched and stored again at this key.
 *
 * ⛔ THE SOURCE BUCKET IS ASKED ABOUT EXACTLY AS THE DESTINATION WAS — the pair's restriction
 *    first, the resolver second — or a copy would be a way to read a bucket the pair may not.
 *
 * ⛔ THE SOURCE IS READ FROM THE LIST AS IT IS NOW, not as cached: its conditions
 *    (`x-amz-copy-source-if-*`) are about the file that will be copied, and a cached list can name
 *    one that has since been replaced.
 */
export async function copyObject(call, writer, header) {
    const from = copySourceOf(header);
    checkKey(call.key);
    const condition = writeConditionOf(call.req, "CopyObject");
    const sourceCondition = copySourceConditionOf(call.req);
    if (!mayTouch(call.verdict.credential, from.bucket)) {
        refuse(call.res, 403, "AccessDenied", NOT_YOURS, call.resource);
        return;
    }
    const source = from.bucket === call.bucket ? call.source : await call.options.bucketOf(from.bucket);
    if (source === null) {
        refuse(call.res, 404, "NoSuchBucket", `No bucket named ${from.bucket} is served here.`, call.resource);
        return;
    }
    const object = objectsOf(await source.entries({ fresh: true })).find((o) => o.key === from.key);
    if (object === undefined) {
        refuse(call.res, 404, "NoSuchKey", "The copy source is not in that bucket's file list.", call.resource);
        return;
    }
    checkCopySource(object, sourceCondition);
    const asked = metaOf(call.req);
    const replacing = (headerOf(call.req, "x-amz-metadata-directive") ?? "COPY").trim().toUpperCase() === "REPLACE";
    if (from.bucket === call.bucket && from.key === call.key) {
        // ⚠ A COPY ONTO ITSELF CHANGES NOTHING HERE BUT WHAT IS NOT KEPT. Nothing about a file but its
        //   bytes is kept, so "the same bytes with new metadata" or "in another storage class" is
        //   already true of the file as it stands, and nothing is sent. S3 refuses only a self-copy
        //   that asks for no change at all.
        if (!replacing && asked.storageClass === null) {
            throw new S3Refusal(400, "InvalidRequest", "This copy request is illegal because it is trying to copy an object to itself without changing the " +
                "object's metadata, storage class, website redirect location or encryption attributes.");
        }
        checkWriteCondition(object, condition);
        sendXml(call.res, 200, copyObjectXml(object.etag, object.lastModified));
        return;
    }
    if (isFolderKey(call.key)) {
        throw new S3Refusal(400, "InvalidArgument", "A copy cannot be stored at a key ending in `/`, which names a folder.");
    }
    checkNotEmpty(object.size);
    checkDeclaredSize(object.size, writer.maxObjectBytes);
    precheck(objectsOf(await call.source.entries()), call.key, condition);
    // ⛔ EVERY REFUSAL ABOVE KEEPS ITS OWN STATUS, AND SO DOES ONE BELOW THAT COMES WITHIN ONE
    //    KEEP-ALIVE INTERVAL (`long-answer.ts`). Only a fetch and store that outlasts it begins the
    //    200, and what that comes to -- a taken key included, which only the bytes can decide -- is
    //    then an error document in the 200 body.
    await answerAfter(call, async (accepted) => {
        accepted();
        const outcome = await writer.copy({ source, object }, call.key, { storageClass: asked.storageClass, contentType: replacing ? asked.contentType : null }, condition);
        const stored = objectsOf(await call.source.entries()).find((o) => o.etag === outcome.etag);
        return copyObjectXml(outcome.etag, stored?.lastModified ?? new Date().toISOString());
    });
}
export async function deleteObject(call, writer) {
    const condition = deleteConditionOf(call.req);
    // S3 answers 204 for a key that is not there, and clients rely on it: a sync that deletes the
    // same key twice must not fail the second time.
    const [outcome] = await writer.remove([call.key], condition);
    if (outcome !== undefined && outcome.error !== null)
        throw outcome.error;
    call.res.writeHead(204);
    call.res.end();
}
/** The integrity headers S3 requires on a `DeleteObjects`: one of them has to be there. */
const INTEGRITY = /^(content-md5|x-amz-checksum-(crc32|crc32c|crc64nvme|sha1|sha256)|x-amz-trailer)$/;
/**
 * `DeleteObjects`: up to a thousand keys in one request, each answered on its own.
 *
 * ⛔ ONE KEY'S FAILURE IS THAT KEY'S ANSWER, not the request's. S3 answers 200 with an `Error` row
 *    for the key that failed and a `Deleted` row for every other; a client retries the rows that
 *    failed. Failing the whole request for one would have it retry — and re-send — all of them.
 *
 * ⛔ THE LIST OF KEYS MUST CARRY A DIGEST, AS S3 REQUIRES. Signed as `UNSIGNED-PAYLOAD`, nothing
 *    else binds the body to the signature, and a body swapped on the way would trash files the
 *    client never named. `Content-MD5` or an `x-amz-checksum-*` is required, and the body decoder
 *    holds the bytes to it.
 */
export async function deleteObjects(call, writer) {
    refuseConditions(call.req, "DeleteObjects");
    const body = decodeBody(call.req, call.verdict);
    if (body instanceof BodyRefusal)
        throw body;
    const text = await consuming(body, () => readBodyText(body, MAX_DELETE_BODY, "The list of keys to delete"));
    // ⚠ Refused once the body is read — a mebibyte at most — so the connection is left clean for the
    //   client's next request rather than closed under it with its list unread.
    if (!Object.keys(call.req.headers).some((name) => INTEGRITY.test(name))) {
        throw new S3Refusal(400, "InvalidRequest", "Missing required header for this request: Content-MD5 or an x-amz-checksum-* header. Nothing was deleted.");
    }
    const root = parseXml(text);
    const ask = deleteAskOf(root);
    // ⛔ A CONDITION ON ONE KEY OF THE BATCH IS REFUSED, NOT DROPPED. S3 lets each `<Object>` carry
    //    an `<ETag>`, a `<LastModifiedTime>` or a `<Size>` it must match; the list read here keeps
    //    none of them, and deleting a key whose condition was never checked is the one thing the
    //    client sent it to prevent.
    const conditional = root.children.some((object) => object.name === "Object" &&
        object.children.some((field) => field.name === "ETag" || field.name === "LastModifiedTime" || field.name === "Size"));
    if (conditional) {
        throw new S3Refusal(501, "NotImplemented", "This gateway does not honour a condition on a key in a batch delete. Delete that key with DeleteObject and If-Match. Nothing was deleted.");
    }
    // ⚠ A THOUSAND KEYS IS A LONG WRITE, and the answer is begun first so the connection is not
    //   silent while it runs (`long-answer.ts`).
    await answerAfter(call, async (accepted) => {
        accepted();
        const errors = [];
        const versioned = new Set();
        ask.objects.forEach(({ key, versionId }, at) => {
            if (versionId !== null && versionId !== "null") {
                versioned.add(at);
                errors.push({ key, code: "NotImplemented", message: "This gateway keeps no versions." });
            }
        });
        const keys = ask.objects.filter((_, at) => !versioned.has(at)).map((o) => o.key);
        const outcomes = keys.length === 0 ? [] : await writer.remove(keys);
        const deleted = [];
        for (const { key, error } of outcomes) {
            if (error === null) {
                deleted.push(key);
                continue;
            }
            const answer = answerFor(error);
            errors.push({ key, code: answer.code, message: answer.message });
        }
        return deleteResultXml({ deleted: ask.quiet ? [] : deleted, errors });
    });
}

// Uploads that arrive in pieces.
//
// ⛔ WHY IT IS NOT OPTIONAL. Every S3 client switches to this above a size of its own choosing --
//    rclone's default is 200 MiB -- so a gateway without it works on small files and fails on the
//    large ones, which is the half of a backup that matters most.
//
// ⛔ MEASURED FROM A REAL CLIENT, NOT FROM THE SPECIFICATION. What rclone actually sends is:
//    `POST ?uploads=` to begin · `PUT ?partNumber=N&uploadId=…` for each piece, CONCURRENTLY AND
//    OUT OF ORDER (1, 3, 2 in the capture) · `POST ?uploadId=…` carrying the part list to finish.
//    The out-of-order part is the one a from-the-specification implementation gets wrong, because
//    reading the spec top to bottom suggests a sequence.
//
// ⛔ THE PART LIST THE CLIENT SENDS IS WHAT THE FILE IS MADE OF. A client may stage a piece it then
//    leaves out — a retry that sent part 3 twice under different numbers, a resumed upload that
//    re-cut its pieces — and S3 builds the object from the list, checking each listed tag against
//    what it staged. Joining everything staged instead makes a file that is longer than the one
//    the client meant, and reports it as stored.
//
// ⚠ THE PIECES ARE STAGED, and staging is the caller's business rather than this file's: this
//   module speaks the protocol and the staging it is handed does the filesystem.
import { S3Refusal, sendXml } from "./answer.js";
import { BodyRefusal, decodeBody } from "./body.js";
import { headerOf, metaOf } from "./call.js";
import { algorithmOfHeader, parseChecksumValue } from "./checksum.js";
import { refuseConditions, writeConditionOf } from "./drive-conditions.js";
import { checkKey } from "./drive-key.js";
import { checkDeclaredSize } from "./drive-limits.js";
import { precheck } from "./drive-write.js";
import { compareKeys, isFolderKey, objectsOf } from "./listing.js";
import { answerAfter } from "./long-answer.js";
import { consuming, readBodyText } from "./spool.js";
import { completeUploadXml, initiateUploadXml } from "./xml.js";
import { listPartsXml, listUploadsXml } from "./xml-multipart.js";
import { completeAskOf, parseXml } from "./xml-read.js";
/** S3's own ceiling, and a bound on what one client can stage on this machine. */
export const MAX_PARTS = 10_000;
/** Ten thousand parts, each with its tag and checksums, fit well inside this. */
export const MAX_COMPLETE_BODY = 4 * 1024 * 1024;
/** The most rows one listing answers — S3's number for both. */
export const MAX_LISTED = 1000;
/** An integer query parameter, clamped, or the fallback when it is absent or not a number. */
function intParam(query, name, fallback, max) {
    const raw = query.get(name);
    if (raw === null || !/^\d{1,9}$/.test(raw.trim()))
        return fallback;
    return Math.min(Number(raw.trim()), max);
}
export async function beginUpload(call, staging) {
    checkKey(call.key);
    if (isFolderKey(call.key)) {
        throw new S3Refusal(400, "InvalidArgument", "A key ending in `/` names a folder, which is not uploaded in parts.");
    }
    refuseConditions(call.req, "CreateMultipartUpload");
    const uploadId = await staging.begin(call.key, metaOf(call.req));
    sendXml(call.res, 200, initiateUploadXml(call.bucket, call.key, uploadId));
}
export async function uploadPart(call, staging, uploadId, maxObjectBytes) {
    const raw = call.query.get("partNumber") ?? "";
    const partNumber = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
    if (partNumber < 1 || partNumber > MAX_PARTS) {
        const why = `Part number must be an integer between 1 and ${MAX_PARTS}, inclusive.`;
        throw new S3Refusal(400, "InvalidArgument", why);
    }
    refuseConditions(call.req, "UploadPart");
    const body = decodeBody(call.req, call.verdict);
    if (body instanceof BodyRefusal)
        throw body;
    const etag = await consuming(body, async () => {
        checkDeclaredSize(body.size, maxObjectBytes);
        return await staging.part(uploadId, call.key, partNumber, body);
    });
    call.res.writeHead(200, { etag, "content-length": "0" });
    call.res.end();
}
/**
 * The whole object's checksum a finish names, if it names one.
 *
 * ⚠ S3's DEFAULT KIND IS COMPOSITE, except for CRC64NVME, which is only ever full-object. A
 *   composite value may carry `-N` after it, the number of parts, which is not part of the value.
 */
function objectChecksumOf(call) {
    let found = null;
    const typed = headerOf(call.req, "x-amz-checksum-type")?.trim().toUpperCase();
    if (typed !== undefined && typed !== "FULL_OBJECT" && typed !== "COMPOSITE") {
        throw new S3Refusal(400, "InvalidRequest", `x-amz-checksum-type is FULL_OBJECT or COMPOSITE, not ${typed}.`);
    }
    for (const [name, raw] of Object.entries(call.req.headers)) {
        const algorithm = algorithmOfHeader(name);
        if (algorithm === null)
            continue;
        const text = (Array.isArray(raw) ? raw.join(",") : (raw ?? "")).trim().replace(/-\d+$/, "");
        const value = parseChecksumValue(algorithm, text);
        if (value === null)
            throw new S3Refusal(400, "InvalidRequest", `${name} is not a ${algorithm} value.`);
        if (found !== null)
            throw new S3Refusal(400, "InvalidRequest", "A finish may name one checksum of the whole object.");
        const type = typed ?? (algorithm === "crc64nvme" ? "FULL_OBJECT" : "COMPOSITE");
        found = { algorithm, value, type };
    }
    return found;
}
export async function completeUpload(call, staging, uploadId) {
    const condition = writeConditionOf(call.req, "CompleteMultipartUpload");
    const checksum = objectChecksumOf(call);
    // ⛔ `x-amz-checksum-*` HERE IS THE OBJECT'S, NOT THE PART LIST'S — see `multipart-assemble.ts`.
    const body = decodeBody(call.req, call.verdict, { checksumsDescribeObject: true });
    if (body instanceof BodyRefusal)
        throw body;
    const text = await consuming(body, () => readBodyText(body, MAX_COMPLETE_BODY, "The part list"));
    const parts = completeAskOf(parseXml(text));
    precheck(objectsOf(await call.source.entries()), call.key, condition);
    // ⛔ The 200 begins when the staging says the upload and the list hold — see `long-answer.ts`.
    await answerAfter(call, async (accepted) => {
        const outcome = await staging.complete(uploadId, call.key, parts, { accepted, condition, checksum });
        return completeUploadXml(call.bucket, call.key, outcome.etag);
    });
}
export async function abortUpload(call, staging, uploadId) {
    refuseConditions(call.req, "AbortMultipartUpload");
    await staging.abort(uploadId, call.key);
    call.res.writeHead(204);
    call.res.end();
}
/** `ListParts`: the pieces of one upload, a page at a time. */
export async function listParts(call, staging, uploadId) {
    if (staging === undefined) {
        throw new S3Refusal(404, "NoSuchUpload", "No upload is in progress with that id.");
    }
    const all = await staging.parts(uploadId, call.key);
    const marker = intParam(call.query, "part-number-marker", 0, MAX_PARTS);
    const maxParts = intParam(call.query, "max-parts", MAX_LISTED, MAX_LISTED);
    const after = all.filter((part) => part.partNumber > marker);
    const page = after.slice(0, maxParts);
    const meta = (await staging.uploads()).find((upload) => upload.uploadId === uploadId)?.meta;
    sendXml(call.res, 200, listPartsXml({
        bucket: call.bucket,
        key: call.key,
        uploadId,
        storageClass: meta?.storageClass ?? "STANDARD",
        marker,
        maxParts,
        parts: page.map((part) => ({ ...part, lastModified: new Date(part.stagedAt).toISOString() })),
        truncated: after.length > page.length,
    }));
}
/**
 * `ListMultipartUploads`: every upload begun here and not yet finished or aborted.
 *
 * ⚠ A READ-ONLY DRIVE HAS NONE, and says so with an empty list rather than a refusal: the question
 *   has a true answer, and `rclone cleanup` asks it before deciding there is nothing to clean.
 *
 * ⛔ PAGED OVER ROWS, NOT UPLOADS. A common prefix is one row however many uploads it stands for,
 *    and the next page resumes after the last row answered — the prefix itself, when that is what
 *    it was, so none of the uploads it stood for come back on the next page as if new. And one
 *    key's uploads resume after the marker's id whether or not that upload still exists: ids sort
 *    by when they began (`staging.ts`), so an upload finished between two pages costs the listing
 *    nothing.
 */
export async function listUploads(call, staging) {
    const query = call.query;
    const prefix = query.get("prefix") ?? "";
    const delimiter = query.get("delimiter") ?? "";
    const keyMarker = query.get("key-marker") ?? "";
    const uploadIdMarker = query.get("upload-id-marker") ?? "";
    const maxUploads = intParam(query, "max-uploads", MAX_LISTED, MAX_LISTED);
    const all = (staging === undefined ? [] : await staging.uploads()).filter((upload) => upload.key.startsWith(prefix));
    const rows = [];
    const grouped = new Set();
    for (const upload of all) {
        const rest = upload.key.slice(prefix.length);
        const at = delimiter === "" ? -1 : rest.indexOf(delimiter);
        if (at < 0) {
            rows.push({ sort: upload.key, upload });
            continue;
        }
        const common = prefix + rest.slice(0, at + delimiter.length);
        if (grouped.has(common))
            continue;
        grouped.add(common);
        rows.push({ sort: common, upload: null });
    }
    const idOf = (row) => row.upload?.uploadId ?? "";
    rows.sort((a, b) => compareKeys(a.sort, b.sort) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
    const started = keyMarker === ""
        ? rows
        : rows.filter((row) => compareKeys(row.sort, keyMarker) > 0 ||
            (row.upload !== null && row.sort === keyMarker && uploadIdMarker !== "" && idOf(row) > uploadIdMarker));
    const page = started.slice(0, maxUploads);
    const truncated = maxUploads > 0 && started.length > page.length;
    const last = page[page.length - 1];
    const uploads = [];
    const commonPrefixes = [];
    for (const row of page) {
        if (row.upload === null) {
            commonPrefixes.push(row.sort);
            continue;
        }
        uploads.push({
            key: row.upload.key,
            uploadId: row.upload.uploadId,
            initiated: new Date(row.upload.initiated).toISOString(),
            storageClass: row.upload.meta.storageClass ?? "STANDARD",
        });
    }
    sendXml(call.res, 200, listUploadsXml({
        bucket: call.bucket,
        prefix,
        delimiter,
        keyMarker,
        uploadIdMarker,
        maxUploads,
        uploads,
        commonPrefixes,
        truncated,
        nextKeyMarker: truncated && last !== undefined ? last.sort : "",
        nextUploadIdMarker: truncated && last !== undefined ? idOf(last) : "",
        encodingType: query.get("encoding-type"),
    }));
}

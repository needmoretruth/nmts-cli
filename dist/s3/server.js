// The gateway itself: an S3 request in, this account's drive out.
//
// ⛔ LOOPBACK ONLY, AND NO OPTION TO CHANGE IT. The machine running this already holds the account
//    code, and one signature is all that stands between a request and every file in the account.
//    Bound to an address other people can reach, that one signature becomes the whole lock on the
//    account -- and the key it checks was printed on somebody's terminal. This is the same call the
//    rest of the system made on 2026-08-20 when every container port was pulled back to loopback.
//
// ⛔ WHAT IS NOT ANSWERED IS REFUSED, LOUDLY. An S3 client that asks for something this gateway does
//    not do gets 501 and a sentence naming what it does do. The alternative -- answering an empty
//    listing, or a 200 with nothing behind it -- is how a backup tool reports success over a backup
//    that never happened.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { BUCKET, listObjects, objectsOf, folderPrefixesOf, MAX_KEYS_LIMIT } from "./listing.js";
import { handleMultipart, isMultipartRequest } from "./multipart.js";
import { responseSink } from "./response-sink.js";
import { STREAMING_PAYLOAD, STREAMING_PAYLOAD_TRAILER, verifySignature, } from "./sigv4.js";
import { errorXml, listBucketsXml, listObjectsXml } from "./xml.js";
/** Where the drive is served. Loopback, always — see the note above. */
export const BIND_ADDRESS = "127.0.0.1";
/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export function newCredential() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const raw = randomBytes(20);
    let id = "NMTS";
    for (const byte of raw)
        id += letters[byte % letters.length] ?? "A";
    return { accessKeyId: id.slice(0, 20), secretAccessKey: randomBytes(30).toString("base64url") };
}
function fail(res, status, code, message, resource) {
    const body = errorXml(code, message, resource);
    res.writeHead(status, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
    res.end(body);
}
/** `/drive/photos/a.jpg` → bucket `drive`, key `photos/a.jpg`. */
function splitPath(pathname) {
    const trimmed = pathname.replace(/^\//, "");
    const at = trimmed.indexOf("/");
    if (at < 0)
        return { bucket: decodeURIComponent(trimmed), key: "" };
    return { bucket: decodeURIComponent(trimmed.slice(0, at)), key: decodeURIComponent(trimmed.slice(at + 1)) };
}
function headerOf(req, name) {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw.join(",") : raw;
}
/** The one sentence a write gets when this machine has not agreed to spending. */
function readOnlyBecause() {
    return ("This gateway is read only. Uploading spends credits, and this machine has not agreed to " +
        "spending — `nmts consent grant spend`, run by the person whose account this is, is what " +
        "changes that. Nothing was written.");
}
function objectHeaders(object) {
    return {
        "content-type": "application/octet-stream",
        "last-modified": new Date(object.entry.updatedAt).toUTCString(),
        etag: object.etag,
        "accept-ranges": "none",
    };
}
async function handle(req, res, options) {
    const url = req.url ?? "/";
    const at = url.indexOf("?");
    const pathname = at < 0 ? url : url.slice(0, at);
    const query = new URLSearchParams(at < 0 ? "" : url.slice(at + 1));
    const method = (req.method ?? "GET").toUpperCase();
    const verdict = verifySignature({ method, url, headers: req.headers }, options.credential, options.now?.() ?? Date.now());
    if (!verdict.ok) {
        fail(res, verdict.code === "InvalidAccessKeyId" ? 403 : 403, verdict.code, verdict.message, pathname);
        return;
    }
    const { bucket, key } = splitPath(pathname);
    if (pathname === "/" && (method === "GET" || method === "HEAD")) {
        const body = listBucketsXml(BUCKET, new Date(0).toISOString());
        res.writeHead(200, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
        res.end(method === "HEAD" ? undefined : body);
        return;
    }
    if (bucket !== BUCKET) {
        fail(res, 404, "NoSuchBucket", `This gateway serves one bucket, named ${BUCKET}.`, pathname);
        return;
    }
    // ⛔ MEASURED, NOT GUESSED: rclone's first act when copying a file is to create the bucket, and a
    //    refusal here ends the copy before the upload is ever attempted. The bucket exists, so the
    //    honest answer to "make it" is that it is made.
    if (key === "" && method === "PUT") {
        res.writeHead(200, { "content-length": "0" });
        res.end();
        return;
    }
    const entries = await options.source.entries();
    if (key === "" && (method === "GET" || method === "HEAD")) {
        const objects = objectsOf(entries);
        const listing = listObjects(objects, folderPrefixesOf(entries), {
            prefix: query.get("prefix") ?? "",
            delimiter: query.get("delimiter") ?? "",
            maxKeys: Number(query.get("max-keys") ?? MAX_KEYS_LIMIT) || MAX_KEYS_LIMIT,
            after: query.get("continuation-token") ?? query.get("start-after") ?? query.get("marker"),
        });
        const body = listObjectsXml({
            bucket: BUCKET,
            prefix: query.get("prefix") ?? "",
            delimiter: query.get("delimiter") ?? "",
            maxKeys: Number(query.get("max-keys") ?? MAX_KEYS_LIMIT) || MAX_KEYS_LIMIT,
            v2: query.get("list-type") === "2",
            contents: listing.contents,
            commonPrefixes: listing.commonPrefixes,
            truncated: listing.truncated,
            next: listing.next,
            encodingType: query.get("encoding-type"),
        });
        res.writeHead(200, { "content-type": "application/xml", "content-length": String(Buffer.byteLength(body)) });
        res.end(method === "HEAD" ? undefined : body);
        options.log?.(`${method} list prefix=${query.get("prefix") ?? ""} → ${listing.contents.length} keys`);
        return;
    }
    if (method === "HEAD" || method === "GET") {
        const object = objectsOf(entries).find((o) => o.key === key);
        if (object === undefined) {
            fail(res, 404, "NoSuchKey", "This account's file list has no such file.", pathname);
            return;
        }
        if (method === "HEAD") {
            res.writeHead(200, { ...objectHeaders(object), "content-length": String(object.size) });
            res.end();
            options.log?.(`HEAD ${key}`);
            return;
        }
        if (object.entry.dekWrapped === undefined) {
            fail(res, 500, "InternalError", "That entry has no key in the file list.", pathname);
            return;
        }
        const sink = responseSink(res, { headers: objectHeaders(object) });
        try {
            await options.source.fetch(object, sink);
            options.log?.(`GET ${key} → ${object.size} bytes`);
        }
        catch (error) {
            await sink.abandon();
            if (!res.headersSent) {
                fail(res, 502, "InternalError", error instanceof Error ? error.message : String(error), pathname);
            }
            options.log?.(`GET ${key} → failed`);
        }
        return;
    }
    const writer = options.source.write;
    // ⛔ ONE ANSWER FOR ONE QUESTION. Both ways of uploading have to refuse an existing key
    //    identically, or a client that switches to pieces at some size gets a different rule for
    //    large files than for small ones — and the difference would appear only above the threshold.
    const takenKey = () => objectsOf(entries).some((o) => o.key === key);
    const refuseExisting = () => {
        fail(res, 409, "InvalidRequest", "There is already a file at that key, and this drive does not replace files. Delete it " +
            "first — a delete puts it in the trash, where it stays recoverable for thirty days.", pathname);
    };
    if (isMultipartRequest(method, query) && key !== "") {
        if (writer === undefined) {
            fail(res, 501, "NotImplemented", readOnlyBecause(), pathname);
            return;
        }
        if (method === "POST" && query.has("uploads") && takenKey()) {
            refuseExisting();
            return;
        }
        const handled = await handleMultipart({
            req,
            res,
            bucket: BUCKET,
            key,
            method,
            query,
            writer,
            payloadHash: /^[0-9a-f]{64}$/.test(verdict.payloadHash) ? verdict.payloadHash : null,
            fail: (status, code, message) => fail(res, status, code, message, pathname),
            ...(options.log === undefined ? {} : { log: options.log }),
        });
        if (handled)
            return;
    }
    if (method === "PUT" && key !== "") {
        if (writer === undefined) {
            fail(res, 501, "NotImplemented", readOnlyBecause(), pathname);
            return;
        }
        const declared = headerOf(req, "x-amz-content-sha256");
        if (declared === STREAMING_PAYLOAD || declared === STREAMING_PAYLOAD_TRAILER) {
            fail(res, 501, "NotImplemented", "This gateway does not read chunk-signed uploads yet. Tell the client to send the body " +
                "unsigned (the AWS CLI calls this --no-sign-payload on http endpoints; rclone already " +
                "does it).", pathname);
            return;
        }
        const length = Number(headerOf(req, "content-length") ?? "");
        if (!Number.isInteger(length) || length < 0) {
            fail(res, 411, "MissingContentLength", "This gateway needs to know the size before it starts.", pathname);
            return;
        }
        // ⛔ AN EXISTING KEY IS A CONFLICT, NOT AN OVERWRITE. This drive never replaces a file: the same
        //    name arrives as a numbered copy, which is a product decision and not this gateway's to
        //    change. Answering 200 while writing "name (2)" would tell a sync tool it had updated a
        //    file it had in fact duplicated, and it would go on duplicating on every run.
        if (takenKey()) {
            refuseExisting();
            return;
        }
        try {
            await writer.put(key, req, length);
        }
        catch (error) {
            fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), pathname);
            return;
        }
        res.writeHead(200, { "content-length": "0" });
        res.end();
        options.log?.(`PUT ${key} → ${length} bytes`);
        return;
    }
    if (method === "DELETE" && key !== "") {
        if (writer === undefined) {
            fail(res, 501, "NotImplemented", readOnlyBecause(), pathname);
            return;
        }
        const object = objectsOf(entries).find((o) => o.key === key);
        if (object === undefined) {
            // S3 answers 204 for a key that is not there, and clients rely on it: a sync that deletes
            // the same key twice must not fail the second time.
            res.writeHead(204);
            res.end();
            return;
        }
        try {
            await writer.trash(object);
        }
        catch (error) {
            fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), pathname);
            return;
        }
        res.writeHead(204);
        res.end();
        options.log?.(`DELETE ${key} → trash`);
        return;
    }
    fail(res, 501, "NotImplemented", `This gateway does not answer ${method} on that address.`, pathname);
}
export function createGateway(options) {
    return createServer((req, res) => {
        handle(req, res, options).catch((error) => {
            if (!res.headersSent) {
                fail(res, 500, "InternalError", error instanceof Error ? error.message : String(error), req.url ?? "/");
            }
            else {
                res.destroy();
            }
        });
    });
}

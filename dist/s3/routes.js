// Which answer an S3 request gets: the signature first, then the bucket, then the operation.
//
// ⛔ WHAT IS NOT ANSWERED IS REFUSED, LOUDLY. Every request is classified before anything is read
//    or written — the verb, whether it names a key, and which sub-resource it asks about — and a
//    combination this gateway does not do gets 501 and a sentence naming it. The alternative --
//    answering an empty listing, or a 200 with nothing behind it, or the file itself for a question
//    about the file -- is how a backup tool reports success over a backup that never happened.
import { failWith, refuse, S3Refusal, sendXml } from "./answer.js";
import { addressOf, subResourceOf } from "./address.js";
import { headerOf, mayTouch, NOT_YOURS, readOnlyBecause } from "./call.js";
import { MAX_CONCURRENT_WRITES, RETRY_AFTER_SECONDS } from "./drive-limits.js";
import { queryParts } from "./sigv4-canonical.js";
import { folderPrefixesOf, listObjects, MAX_KEYS_LIMIT, objectsOf } from "./listing.js";
import { abortUpload, beginUpload, completeUpload, listParts, listUploads, uploadPart } from "./multipart.js";
import { readObject } from "./object-read.js";
import { copyObject, deleteObject, deleteObjects, putObject } from "./object-write.js";
import { verifyAgainst } from "./sigv4.js";
import { listBucketsXml, listObjectsXml, locationXml, versioningXml } from "./xml.js";
/** What `ListBuckets` says: what the gateway can name, narrowed to what this pair may touch. */
async function bucketsFor(options, credential) {
    const only = credential.buckets;
    if (options.bucketNames === undefined)
        return only ?? [];
    const named = await options.bucketNames();
    return only === undefined ? named : named.filter((name) => only.includes(name));
}
/**
 * `max-keys` as S3 reads it: absent is the ceiling, above it is the ceiling, zero is zero keys, and
 * anything that is not a whole number of zero or more is refused.
 *
 * ⛔ THE NUMBER APPLIED IS THE NUMBER ECHOED in `<MaxKeys>`. `0` used to be read as "not given" and
 *    answered a thousand keys, and a negative number sliced the listing from its far end.
 */
function maxKeysOf(query) {
    const raw = query.get("max-keys");
    if (raw === null)
        return MAX_KEYS_LIMIT;
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
        throw new S3Refusal(400, "InvalidArgument", "Provided max-keys not an integer or within integer range.");
    }
    const asked = Number(trimmed);
    if (asked < 0)
        throw new S3Refusal(400, "InvalidArgument", "max-keys must be zero or more.");
    return Math.min(asked, MAX_KEYS_LIMIT);
}
/**
 * The query, decoded exactly as the signature decodes it.
 *
 * ⛔ ONE DECODING. `URLSearchParams` reads `+` as a space and the signature check, like S3, reads
 *    it as `+`: a prefix of `a+b` was signed as one string and answered as another. Every
 *    parameter is taken from the same decoder the signature used, so what was signed is what is
 *    answered.
 */
function queryOf(raw) {
    const query = new URLSearchParams();
    for (const part of queryParts(raw))
        query.append(part.key, part.value);
    return query;
}
/** How many writes are running now, per gateway. */
const writesRunning = new WeakMap();
/**
 * Run one write, or answer `SlowDown` when the gateway is already running as many as it allows.
 *
 * ⛔ A CEILING ON WHAT IS HELD AT ONCE. Every write in flight holds a spool of somebody's bytes on
 *    this disk and a connection to the network behind it; with no ceiling a client that opens a
 *    thousand uploads at once holds a thousand. S3's own answer to "too much at once" is 503
 *    `SlowDown`, and every client waits and sends again.
 */
async function limited(call, work) {
    const ceiling = call.options.maxConcurrentWrites ?? MAX_CONCURRENT_WRITES;
    let running = writesRunning.get(call.options);
    if (running === undefined) {
        running = { count: 0 };
        writesRunning.set(call.options, running);
    }
    if (running.count >= ceiling) {
        refuse(call.res, 503, "SlowDown", `This gateway is already running ${running.count} writes, the most it runs at once. Send it again shortly.`, call.resource, { "retry-after": String(RETRY_AFTER_SECONDS) });
        return;
    }
    running.count += 1;
    try {
        await work();
    }
    finally {
        running.count -= 1;
    }
}
async function listBucket(call) {
    const { query } = call;
    const maxKeys = maxKeysOf(query);
    const entries = await call.source.entries();
    const prefix = query.get("prefix") ?? "";
    const delimiter = query.get("delimiter") ?? "";
    const listing = listObjects(objectsOf(entries), folderPrefixesOf(entries), {
        prefix,
        delimiter,
        maxKeys,
        after: query.get("continuation-token") ?? query.get("start-after") ?? query.get("marker"),
    });
    sendXml(call.res, 200, listObjectsXml({
        bucket: call.bucket,
        prefix,
        delimiter,
        maxKeys,
        v2: query.get("list-type") === "2",
        contents: listing.contents,
        commonPrefixes: listing.commonPrefixes,
        truncated: listing.truncated,
        next: listing.next,
        encodingType: query.get("encoding-type"),
    }));
}
/** Classify one request against its bucket. Nothing is read or written until `run`. */
function routeOf(call) {
    const { method, query, key, res, resource, options } = call;
    const sub = subResourceOf(query);
    const writer = call.source.write;
    const staging = writer?.multipart;
    const notDone = (why) => ({
        name: "NotImplemented",
        run: () => refuse(res, 501, "NotImplemented", why, resource),
    });
    const writing = (name, run) => writer === undefined
        ? { name, run: () => refuse(res, 501, "NotImplemented", readOnlyBecause(options), resource) }
        : { name, run: () => limited(call, () => run(writer)) };
    const staged = (name, run) => writing(name, async () => {
        if (staging !== undefined)
            await run(staging);
        else
            refuse(res, 501, "NotImplemented", "This gateway does not stage multipart uploads.", resource);
    });
    if (key === "") {
        const read = method === "GET" || method === "HEAD";
        if (sub === "location" && read)
            return { name: "GetBucketLocation", run: () => sendXml(res, 200, locationXml()) };
        if (sub === "versioning" && method === "GET") {
            return { name: "GetBucketVersioning", run: () => sendXml(res, 200, versioningXml()) };
        }
        if (sub === "uploads" && method === "GET") {
            return { name: "ListMultipartUploads", run: () => listUploads(call, staging) };
        }
        if (sub === "delete" && method === "POST")
            return writing("DeleteObjects", (w) => deleteObjects(call, w));
        if (sub !== null)
            return notDone(`This gateway does not answer ${method} ?${sub} on a bucket.`);
        if (method === "HEAD") {
            return {
                name: "HeadBucket",
                run: () => {
                    res.writeHead(200, { "x-amz-bucket-region": "us-east-1", "content-length": "0" });
                    res.end();
                },
            };
        }
        if (method === "GET") {
            return { name: query.get("list-type") === "2" ? "ListObjectsV2" : "ListObjects", run: () => listBucket(call) };
        }
        // ⛔ MEASURED, NOT GUESSED: rclone's first act when copying a file is to create the bucket, and
        //    a refusal here ends the copy before the upload is ever attempted. The bucket exists, so the
        //    honest answer to "make it" is that it is made.
        if (method === "PUT") {
            return {
                name: "CreateBucket",
                run: () => {
                    res.writeHead(200, { "content-length": "0" });
                    res.end();
                },
            };
        }
        return notDone(`This gateway does not answer ${method} on a bucket.`);
    }
    const uploadId = query.get("uploadId");
    if (sub === "uploads") {
        return method === "POST"
            ? staged("CreateMultipartUpload", (s) => beginUpload(call, s))
            : notDone(`This gateway does not answer ${method} ?uploads on a key.`);
    }
    if (sub !== null)
        return notDone(`This gateway does not answer ${method} ?${sub}.`);
    if (uploadId !== null) {
        if (method === "GET")
            return { name: "ListParts", run: () => listParts(call, staging, uploadId) };
        if (method === "PUT" && headerOf(call.req, "x-amz-copy-source") !== undefined) {
            return notDone("This gateway does not copy into a part (UploadPartCopy). Upload the part's bytes instead.");
        }
        if (method === "PUT")
            return staged("UploadPart", (s) => uploadPart(call, s, uploadId, writer?.maxObjectBytes));
        if (method === "POST")
            return staged("CompleteMultipartUpload", (s) => completeUpload(call, s, uploadId));
        if (method === "DELETE")
            return staged("AbortMultipartUpload", (s) => abortUpload(call, s, uploadId));
        return notDone(`This gateway does not answer ${method} on an upload.`);
    }
    if (method === "GET" || method === "HEAD") {
        return { name: method === "GET" ? "GetObject" : "HeadObject", run: () => readObject(call, method === "HEAD") };
    }
    if (method === "PUT") {
        const copySource = headerOf(call.req, "x-amz-copy-source");
        return copySource === undefined
            ? writing("PutObject", (w) => putObject(call, w))
            : writing("CopyObject", (w) => copyObject(call, w, copySource));
    }
    if (method === "DELETE")
        return writing("DeleteObject", (w) => deleteObject(call, w));
    return notDone(`This gateway does not answer ${method} on that address.`);
}
export async function handle(req, res, options) {
    const url = req.url ?? "/";
    const at = url.indexOf("?");
    const pathname = at < 0 ? url : url.slice(0, at);
    const method = (req.method ?? "GET").toUpperCase();
    // ⛔ ONE LINE PER REQUEST: THE OPERATION AND THE STATUS. See `GatewayOptions.log` for why never a key.
    let operation = "Refused";
    const log = options.log;
    if (log !== undefined)
        res.once("close", () => log(`${operation} ${res.statusCode}`));
    let verdict;
    let query;
    try {
        verdict = verifyAgainst({ method, url, headers: req.headers }, options.credentials, options.now?.() ?? Date.now());
        query = queryOf(at < 0 ? "" : url.slice(at + 1));
    }
    catch (error) {
        // The canonical query decodes every parameter, and a malformed one throws there.
        if (!(error instanceof URIError))
            throw error;
        refuse(res, 400, "InvalidURI", "The query string is not valid percent-encoding.", pathname);
        return;
    }
    if (!verdict.ok) {
        refuse(res, 403, verdict.code, verdict.message, pathname);
        return;
    }
    const credential = verdict.credential;
    let address;
    try {
        address = addressOf(pathname, headerOf(req, "host"), options.virtualHostBase);
    }
    catch (error) {
        failWith(res, error, pathname);
        return;
    }
    if (address.bucket === "") {
        if (method !== "GET" && method !== "HEAD") {
            operation = "NotImplemented";
            refuse(res, 501, "NotImplemented", `This gateway does not answer ${method} on the service.`, pathname);
            return;
        }
        operation = "ListBuckets";
        sendXml(res, 200, listBucketsXml(await bucketsFor(options, credential), new Date(0).toISOString()));
        return;
    }
    if (!mayTouch(credential, address.bucket)) {
        refuse(res, 403, "AccessDenied", NOT_YOURS, pathname);
        return;
    }
    const source = await options.bucketOf(address.bucket);
    if (source === null) {
        refuse(res, 404, "NoSuchBucket", `No bucket named ${address.bucket} is served here.`, pathname);
        return;
    }
    const { bucket, key } = address;
    const call = { req, res, method, query, bucket, key, resource: pathname, verdict, options, source };
    const route = routeOf(call);
    operation = route.name;
    try {
        await route.run();
    }
    catch (error) {
        failWith(res, error, pathname);
    }
}

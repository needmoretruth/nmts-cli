// `GetObject` and `HeadObject`: one file, whole or in part, or only what is known about it.
//
// ⛔ THE ETAG HERE IS THE ETAG EVERYWHERE. A listing, a HEAD, a GET and the answer to the upload
//    that stored the file all name the same tag, because all of them come from `etagOf` on the
//    same entry. A sync tool compares them to decide what to fetch again; two that disagree make
//    it fetch everything, every time.
import { validateHeaderValue } from "node:http";
import { failWith, refuse } from "./answer.js";
import { headerOf } from "./call.js";
import { contentTypeOf } from "./content-type.js";
import { objectsOf } from "./listing.js";
import { preconditionOf, rangeOf } from "./range.js";
import { responseSink } from "./response-sink.js";
function httpDate(ms) {
    return new Date(ms).toUTCString();
}
/**
 * The headers a file is answered with.
 *
 * ⛔ A FILE IS NEVER A PAGE OF THE GATEWAY'S ORIGIN. A business serves its users' files from its own
 *    host, often through presigned links a browser opens, and a file named `.html` or `.svg` is
 *    answered with a type a browser runs. `Content-Security-Policy: sandbox` makes whatever it runs
 *    run in an origin of its own, with no scripts and no reach into the host's cookies or storage;
 *    `nosniff` keeps a browser from deciding that a file sent as bytes or text is script after all.
 *    A business that wants its users' files downloaded rather than shown says so per link, with
 *    `response-content-disposition` (below).
 */
export function objectHeaders(object) {
    return {
        "content-type": contentTypeOf(object.key),
        "last-modified": httpDate(object.entry.updatedAt),
        etag: object.etag,
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
    };
}
/**
 * The query parameters S3 lets a signed GET or HEAD use to choose headers of its answer, and the
 * header each one sets. Every request here is signed, so every request may use them -- a presigned
 * link above all, which is how a business makes a link download a file instead of showing it.
 */
const OVERRIDES = [
    ["response-content-type", "content-type"],
    ["response-content-disposition", "content-disposition"],
];
/** The headers this request's `response-*` parameters ask for, or the parameter no header can carry. */
function overridesOf(query) {
    const headers = {};
    for (const [parameter, header] of OVERRIDES) {
        const value = query.get(parameter);
        if (value === null)
            continue;
        try {
            validateHeaderValue(header, value);
        }
        catch {
            return { bad: parameter };
        }
        headers[header] = value;
    }
    return { headers };
}
/** The live file at this call's key, or a 404 already answered. */
export async function objectAt(call) {
    const object = objectsOf(await call.source.entries()).find((o) => o.key === call.key);
    if (object === undefined) {
        refuse(call.res, 404, "NoSuchKey", "This account's file list has no such file.", call.resource);
        return null;
    }
    return object;
}
export async function readObject(call, head) {
    const { res, req } = call;
    const object = await objectAt(call);
    if (object === null)
        return;
    const condition = preconditionOf(req, object.etag, object.entry.updatedAt);
    if (condition === 412) {
        const why = "At least one of the preconditions you specified did not hold.";
        refuse(res, 412, "PreconditionFailed", why, call.resource);
        return;
    }
    if (condition === 304) {
        res.writeHead(304, { etag: object.etag, "last-modified": httpDate(object.entry.updatedAt) });
        res.end();
        return;
    }
    const chosen = overridesOf(call.query);
    if ("bad" in chosen) {
        refuse(res, 400, "InvalidArgument", `${chosen.bad} holds a character no HTTP header can carry.`, call.resource);
        return;
    }
    const headers = { ...objectHeaders(object), ...chosen.headers };
    const range = rangeOf(headerOf(req, "range"), object.size);
    if (range.kind === "unsatisfiable") {
        refuse(res, 416, "InvalidRange", "The requested range is not satisfiable.", call.resource, {
            "content-range": `bytes */${object.size}`,
        });
        return;
    }
    const window = range.kind === "window" ? { start: range.start, end: range.end } : null;
    if (head) {
        res.writeHead(window === null ? 200 : 206, {
            ...headers,
            "content-length": String(window === null ? object.size : window.end - window.start + 1),
            ...(window === null ? {} : { "content-range": `bytes ${window.start}-${window.end}/${object.size}` }),
        });
        res.end();
        return;
    }
    if (object.entry.dekWrapped === undefined) {
        refuse(res, 500, "InternalError", "That entry has no key in the file list.", call.resource);
        return;
    }
    const sink = responseSink(res, { headers, window });
    try {
        await call.source.fetch(object, sink);
    }
    catch (error) {
        // The range was delivered and the reader was stopped on purpose: that is the success path.
        if (sink.windowDelivered())
            return;
        await sink.abandon();
        failWith(res, error, call.resource);
    }
}

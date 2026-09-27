// Which bucket and which key a request names, and whether it names something this gateway does.
//
// ⛔ A SUB-RESOURCE IS NEVER AN OBJECT. `?acl`, `?tagging`, `?policy` and the rest ask about a
//    bucket or a key rather than for its bytes. Falling through to the object branch answered
//    `GET ?acl` with the file, stored the XML of `PUT ?tagging` as the file, and trashed the file
//    on `DELETE ?tagging` — each a 200 for something that did not happen, or something that should
//    not have. Every name below is classified first, and one this gateway does not do is 501.
//
// ⚠ THE PRESIGNED `X-Amz-*` PARAMETERS AND THE SDK'S `x-id` ARE NOT SUB-RESOURCES and are not
//   listed; the signature has already consumed them by the time anything here looks.
import { S3Refusal } from "./answer.js";
/**
 * Every query parameter S3 treats as naming a sub-resource.
 *
 * ⚠ `uploads`, `uploadId`, `delete`, `location` and `versioning` are answered; `versionId` is
 *   listed so that a request for one version is refused rather than answered with the only one.
 */
export const SUB_RESOURCES = [
    "accelerate",
    "acl",
    "analytics",
    "attributes",
    "cors",
    "delete",
    "encryption",
    "intelligent-tiering",
    "inventory",
    "legal-hold",
    "lifecycle",
    "location",
    "logging",
    "metrics",
    "notification",
    "object-lock",
    "ownershipControls",
    "policy",
    "policyStatus",
    "publicAccessBlock",
    "replication",
    "requestPayment",
    "restore",
    "retention",
    "select",
    "tagging",
    "torrent",
    "uploads",
    "versioning",
    "versionId",
    "versions",
    "website",
];
/** The sub-resource this query names, or null when it names none. */
export function subResourceOf(query) {
    for (const name of query.keys()) {
        if (SUB_RESOURCES.includes(name))
            return name;
    }
    return null;
}
function decoded(part) {
    try {
        return decodeURIComponent(part);
    }
    catch {
        throw new S3Refusal(400, "InvalidURI", "The request path is not valid percent-encoding.");
    }
}
/** `Host` without its port, lower-cased. An IPv6 literal keeps its brackets. */
function hostOnly(host) {
    const lower = host.trim().toLowerCase();
    if (lower.startsWith("[")) {
        const close = lower.indexOf("]");
        return close < 0 ? lower : lower.slice(0, close + 1);
    }
    const colon = lower.lastIndexOf(":");
    return colon >= 0 && /^\d*$/.test(lower.slice(colon + 1)) ? lower.slice(0, colon) : lower;
}
/**
 * `/drive/photos/a.jpg` → bucket `drive`, key `photos/a.jpg`; or, virtual-hosted, `Host:
 * drive.s3.example.com` and `/photos/a.jpg` → the same two.
 */
export function addressOf(pathname, host, virtualHostBase) {
    if (virtualHostBase !== undefined && host !== undefined) {
        const base = hostOnly(virtualHostBase).replace(/^\.+/, "");
        const named = hostOnly(host);
        if (base !== "" && named.endsWith(`.${base}`)) {
            const bucket = named.slice(0, named.length - base.length - 1);
            if (bucket !== "")
                return { bucket, key: decoded(pathname.replace(/^\//, "")) };
        }
    }
    const trimmed = pathname.replace(/^\//, "");
    const at = trimmed.indexOf("/");
    if (at < 0)
        return { bucket: decoded(trimmed), key: "" };
    return { bucket: decoded(trimmed.slice(0, at)), key: decoded(trimmed.slice(at + 1)) };
}

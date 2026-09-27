// The XML the S3 protocol answers in.
//
// ⛔ WRITTEN BY HAND, ON PURPOSE. Pulling in an XML builder to emit a few fixed shapes would add a
//    dependency to a tool whose whole dependency list is auditable in one screen, and this is the
//    one place where the output is dictated by somebody else's specification -- there is nothing to
//    design, only to match.
//
// ⚠ EVERY VALUE THAT CAME FROM A FILE NAME IS ESCAPED. Names in this drive are whatever a person
//   typed, including `&` and `<`, and an unescaped one produces XML the client cannot parse -- a
//   listing that fails for one badly-named file and works for everything else.
/**
 * What XML 1.0 cannot carry at all, not even as a character reference: the C0 controls other than
 * tab, line feed and carriage return; U+FFFE and U+FFFF; and half of a surrogate pair.
 */
const UNCARRIABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|\p{Cs}/gu;
/** What stands in for a character XML cannot carry. */
const REPLACEMENT = "\uFFFD";
/** `value` with every character no document may contain replaced by U+FFFD. */
function carriable(value) {
    return value.replace(UNCARRIABLE, REPLACEMENT);
}
/**
 * The five characters XML cannot carry raw, escaped -- and what it cannot carry at all, replaced.
 *
 * ⛔ A NAME WITH A CONTROL CHARACTER IN IT MUST NOT BREAK THE DOCUMENT IT IS LISTED IN. `&#1;` is no
 *    way out: XML 1.0 forbids the reference as it forbids the character, and a parser that meets
 *    either refuses the whole listing -- every other file in it along with the one badly named.
 *    Such a name is answered with U+FFFD in its place, which the client can at least see; the exact
 *    name is what `encoding-type=url` is for, and that path percent-encodes it before it gets here.
 * ⚠ A CARRIAGE RETURN IS LEGAL BUT DOES NOT SURVIVE PARSING: a parser turns it into a line feed,
 *   and the client reads a different name from the one stored. As a reference it arrives intact.
 */
export function escapeXml(value) {
    return carriable(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/\r/g, "&#xD;");
}
export const HEAD = `<?xml version="1.0" encoding="UTF-8"?>`;
export const NS = `http://s3.amazonaws.com/doc/2006-03-01/`;
/** Who owns and began everything here, as far as a client can be told. */
export const OWNER = `<ID>nmts</ID><DisplayName>nmts</DisplayName>`;
/** S3's error document. `requestId` names the answer it belongs to, when there is one to name. */
export function errorXml(code, message, resource, requestId) {
    return (`${HEAD}<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message>` +
        `<Resource>${escapeXml(resource)}</Resource>` +
        (requestId === undefined ? "" : `<RequestId>${escapeXml(requestId)}</RequestId>`) +
        `</Error>`);
}
/**
 * The answer to `ListBuckets`.
 *
 * ⚠ AN EMPTY LIST IS A LEGAL ANSWER AND EVERY CLIENT HANDLES IT. A gateway in front of a
 *   business's own lookup cannot enumerate that business's customers, and naming none is the true
 *   answer there — the caller reaches its own bucket by asking for it by name.
 */
export function listBucketsXml(buckets, createdAt) {
    const rows = buckets
        .map((bucket) => `<Bucket><Name>${escapeXml(bucket)}</Name>` +
        `<CreationDate>${escapeXml(createdAt)}</CreationDate></Bucket>`)
        .join("");
    return (`${HEAD}<ListAllMyBucketsResult xmlns="${NS}"><Owner>${OWNER}</Owner>` +
        `<Buckets>${rows}</Buckets></ListAllMyBucketsResult>`);
}
export function initiateUploadXml(bucket, key, uploadId) {
    return (`${HEAD}<InitiateMultipartUploadResult xmlns="${NS}">` +
        `<Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key>` +
        `<UploadId>${escapeXml(uploadId)}</UploadId></InitiateMultipartUploadResult>`);
}
export function completeUploadXml(bucket, key, etag) {
    return (`${HEAD}<CompleteMultipartUploadResult xmlns="${NS}">` +
        `<Location>/${escapeXml(bucket)}/${escapeXml(key)}</Location>` +
        `<Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key>` +
        `<ETag>${escapeXml(etag)}</ETag></CompleteMultipartUploadResult>`);
}
/**
 * `encoding-type=url` means every name in the answer comes back percent-encoded -- control
 * characters included, which is how a client gets such a name exactly.
 *
 * ⚠ HALF A SURROGATE PAIR HAS NO UTF-8 FORM TO PERCENT-ENCODE, and `encodeURIComponent` throws on
 *   one; it is replaced first, as `escapeXml` would replace it.
 */
export function out(value, encodingType) {
    return escapeXml(encodingType === "url" ? encodeURIComponent(value.replace(/\p{Cs}/gu, REPLACEMENT)) : value);
}
export function listObjectsXml(listing) {
    const enc = listing.encodingType;
    const parts = [
        HEAD,
        `<ListBucketResult xmlns="${NS}">`,
        `<Name>${escapeXml(listing.bucket)}</Name>`,
        `<Prefix>${out(listing.prefix, enc)}</Prefix>`,
        listing.delimiter.length > 0 ? `<Delimiter>${out(listing.delimiter, enc)}</Delimiter>` : "",
        `<MaxKeys>${listing.maxKeys}</MaxKeys>`,
        enc === null ? "" : `<EncodingType>${escapeXml(enc)}</EncodingType>`,
        `<IsTruncated>${listing.truncated ? "true" : "false"}</IsTruncated>`,
    ];
    if (listing.v2) {
        parts.push(`<KeyCount>${listing.contents.length + listing.commonPrefixes.length}</KeyCount>`);
        if (listing.next !== null) {
            parts.push(`<NextContinuationToken>${escapeXml(listing.next)}</NextContinuationToken>`);
        }
    }
    else if (listing.next !== null) {
        parts.push(`<NextMarker>${out(listing.next, enc)}</NextMarker>`);
    }
    for (const row of listing.contents) {
        parts.push(`<Contents><Key>${out(row.key, enc)}</Key>` +
            `<LastModified>${escapeXml(row.lastModified)}</LastModified>` +
            `<ETag>${escapeXml(row.etag)}</ETag>` +
            `<Size>${row.size}</Size>` +
            `<StorageClass>STANDARD</StorageClass></Contents>`);
    }
    for (const prefix of listing.commonPrefixes) {
        parts.push(`<CommonPrefixes><Prefix>${out(prefix, enc)}</Prefix></CommonPrefixes>`);
    }
    parts.push(`</ListBucketResult>`);
    return parts.join("");
}
/**
 * Where the bucket lives: nowhere a region names.
 *
 * ⚠ EMPTY IS S3'S OWN WAY OF SAYING `us-east-1`, which is what a client that asks should sign
 *   with — and this gateway accepts a signature in any region anyway.
 */
export function locationXml() {
    return `${HEAD}<LocationConstraint xmlns="${NS}"/>`;
}
/** Versioning was never turned on, which S3 answers with an empty configuration. */
export function versioningXml() {
    return `${HEAD}<VersioningConfiguration xmlns="${NS}"/>`;
}
export function copyObjectXml(etag, lastModified) {
    return (`${HEAD}<CopyObjectResult xmlns="${NS}"><LastModified>${escapeXml(lastModified)}</LastModified>` +
        `<ETag>${escapeXml(etag)}</ETag></CopyObjectResult>`);
}
/** The answer to `DeleteObjects`. In quiet mode the caller passes no `deleted`, as S3 does. */
export function deleteResultXml(outcome) {
    const deleted = outcome.deleted.map((key) => `<Deleted><Key>${escapeXml(key)}</Key></Deleted>`).join("");
    const errors = outcome.errors
        .map((e) => `<Error><Key>${escapeXml(e.key)}</Key><Code>${escapeXml(e.code)}</Code>` +
        `<Message>${escapeXml(e.message)}</Message></Error>`)
        .join("");
    return `${HEAD}<DeleteResult xmlns="${NS}">${deleted}${errors}</DeleteResult>`;
}

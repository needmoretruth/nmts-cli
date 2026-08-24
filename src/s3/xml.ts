// The XML the S3 protocol answers in.
//
// ⛔ WRITTEN BY HAND, ON PURPOSE. Pulling in an XML builder to emit five fixed shapes would add a
//    dependency to a tool whose whole dependency list is auditable in one screen, and this is the
//    one place where the output is dictated by somebody else's specification -- there is nothing to
//    design, only to match.
//
// ⚠ EVERY VALUE THAT CAME FROM A FILE NAME IS ESCAPED. Names in this drive are whatever a person
//   typed, including `&` and `<`, and an unescaped one produces XML the client cannot parse -- a
//   listing that fails for one badly-named file and works for everything else.

/** The five characters XML cannot carry raw. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>`;
const NS = `http://s3.amazonaws.com/doc/2006-03-01/`;

export function errorXml(code: string, message: string, resource: string): string {
  return (
    `${HEAD}<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message>` +
    `<Resource>${escapeXml(resource)}</Resource></Error>`
  );
}

export function listBucketsXml(bucket: string, createdAt: string): string {
  return (
    `${HEAD}<ListAllMyBucketsResult xmlns="${NS}"><Owner><ID>nmts</ID>` +
    `<DisplayName>nmts</DisplayName></Owner><Buckets><Bucket>` +
    `<Name>${escapeXml(bucket)}</Name><CreationDate>${escapeXml(createdAt)}</CreationDate>` +
    `</Bucket></Buckets></ListAllMyBucketsResult>`
  );
}

export interface ObjectRow {
  readonly key: string;
  readonly lastModified: string;
  readonly etag: string;
  readonly size: number;
}

export interface ListingXml {
  readonly bucket: string;
  readonly prefix: string;
  readonly delimiter: string;
  readonly maxKeys: number;
  /** Version 2 of the listing call names its cursor differently and counts what it returned. */
  readonly v2: boolean;
  readonly contents: readonly ObjectRow[];
  readonly commonPrefixes: readonly string[];
  readonly truncated: boolean;
  /** The cursor a client sends back to continue, when there is more. */
  readonly next: string | null;
  /** What the client asked to be url-encoded, or null when it asked for nothing. */
  readonly encodingType: string | null;
}

/** `encoding-type=url` means every name in the answer comes back percent-encoded. */
function out(value: string, encodingType: string | null): string {
  return escapeXml(encodingType === "url" ? encodeURIComponent(value) : value);
}

export function listObjectsXml(listing: ListingXml): string {
  const enc = listing.encodingType;
  const parts: string[] = [
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
  } else if (listing.next !== null) {
    parts.push(`<NextMarker>${out(listing.next, enc)}</NextMarker>`);
  }
  for (const row of listing.contents) {
    parts.push(
      `<Contents><Key>${out(row.key, enc)}</Key>` +
        `<LastModified>${escapeXml(row.lastModified)}</LastModified>` +
        `<ETag>${escapeXml(row.etag)}</ETag>` +
        `<Size>${row.size}</Size>` +
        `<StorageClass>STANDARD</StorageClass></Contents>`,
    );
  }
  for (const prefix of listing.commonPrefixes) {
    parts.push(`<CommonPrefixes><Prefix>${out(prefix, enc)}</Prefix></CommonPrefixes>`);
  }
  parts.push(`</ListBucketResult>`);
  return parts.join("");
}

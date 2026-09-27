// The XML of the two listings a multipart upload has: its pieces, and the uploads still open.
//
// ⚠ BOTH ARE READ FROM WHAT THIS GATEWAY STAGED, not from the drive. An upload in pieces is not a
//   file until it is finished, so nothing about it is in the account's file list yet.

import { escapeXml, HEAD, NS, out, OWNER } from "./xml.ts";

export interface PartRow {
  readonly partNumber: number;
  readonly lastModified: string;
  readonly etag: string;
  readonly size: number;
}

export interface ListPartsXml {
  readonly bucket: string;
  readonly key: string;
  readonly uploadId: string;
  readonly storageClass: string;
  readonly marker: number;
  readonly maxParts: number;
  readonly parts: readonly PartRow[];
  readonly truncated: boolean;
}

export function listPartsXml(listing: ListPartsXml): string {
  const last = listing.parts[listing.parts.length - 1];
  const rows = listing.parts
    .map(
      (part) =>
        `<Part><PartNumber>${part.partNumber}</PartNumber>` +
        `<LastModified>${escapeXml(part.lastModified)}</LastModified>` +
        `<ETag>${escapeXml(part.etag)}</ETag><Size>${part.size}</Size></Part>`,
    )
    .join("");
  return (
    `${HEAD}<ListPartsResult xmlns="${NS}">` +
    `<Bucket>${escapeXml(listing.bucket)}</Bucket><Key>${escapeXml(listing.key)}</Key>` +
    `<UploadId>${escapeXml(listing.uploadId)}</UploadId>` +
    `<Initiator>${OWNER}</Initiator><Owner>${OWNER}</Owner>` +
    `<StorageClass>${escapeXml(listing.storageClass)}</StorageClass>` +
    `<PartNumberMarker>${listing.marker}</PartNumberMarker>` +
    `<NextPartNumberMarker>${last === undefined ? listing.marker : last.partNumber}</NextPartNumberMarker>` +
    `<MaxParts>${listing.maxParts}</MaxParts>` +
    `<IsTruncated>${listing.truncated ? "true" : "false"}</IsTruncated>` +
    `${rows}</ListPartsResult>`
  );
}

export interface UploadRow {
  readonly key: string;
  readonly uploadId: string;
  readonly initiated: string;
  readonly storageClass: string;
}

export interface ListUploadsXml {
  readonly bucket: string;
  readonly prefix: string;
  readonly delimiter: string;
  readonly keyMarker: string;
  readonly uploadIdMarker: string;
  readonly maxUploads: number;
  readonly uploads: readonly UploadRow[];
  readonly commonPrefixes: readonly string[];
  readonly truncated: boolean;
  readonly nextKeyMarker: string;
  readonly nextUploadIdMarker: string;
  readonly encodingType: string | null;
}

export function listUploadsXml(listing: ListUploadsXml): string {
  const enc = listing.encodingType;
  const rows = listing.uploads
    .map(
      (upload) =>
        `<Upload><Key>${out(upload.key, enc)}</Key><UploadId>${escapeXml(upload.uploadId)}</UploadId>` +
        `<Initiator>${OWNER}</Initiator><Owner>${OWNER}</Owner>` +
        `<StorageClass>${escapeXml(upload.storageClass)}</StorageClass>` +
        `<Initiated>${escapeXml(upload.initiated)}</Initiated></Upload>`,
    )
    .join("");
  const prefixes = listing.commonPrefixes
    .map((prefix) => `<CommonPrefixes><Prefix>${out(prefix, enc)}</Prefix></CommonPrefixes>`)
    .join("");
  return (
    `${HEAD}<ListMultipartUploadsResult xmlns="${NS}">` +
    `<Bucket>${escapeXml(listing.bucket)}</Bucket>` +
    `<KeyMarker>${out(listing.keyMarker, enc)}</KeyMarker>` +
    `<UploadIdMarker>${escapeXml(listing.uploadIdMarker)}</UploadIdMarker>` +
    `<NextKeyMarker>${out(listing.nextKeyMarker, enc)}</NextKeyMarker>` +
    `<NextUploadIdMarker>${escapeXml(listing.nextUploadIdMarker)}</NextUploadIdMarker>` +
    (listing.delimiter === "" ? "" : `<Delimiter>${out(listing.delimiter, enc)}</Delimiter>`) +
    `<Prefix>${out(listing.prefix, enc)}</Prefix>` +
    `<MaxUploads>${listing.maxUploads}</MaxUploads>` +
    (enc === null ? "" : `<EncodingType>${escapeXml(enc)}</EncodingType>`) +
    `<IsTruncated>${listing.truncated ? "true" : "false"}</IsTruncated>` +
    `${rows}${prefixes}</ListMultipartUploadsResult>`
  );
}

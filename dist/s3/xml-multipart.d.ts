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
export declare function listPartsXml(listing: ListPartsXml): string;
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
export declare function listUploadsXml(listing: ListUploadsXml): string;

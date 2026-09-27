export interface XmlElement {
    /** The local name: whatever followed the prefix, when there was one. */
    readonly name: string;
    readonly children: readonly XmlElement[];
    /** The element's own text, entities decoded, not trimmed. */
    readonly text: string;
}
/** Parse one document into its root element, or refuse it as `MalformedXML`. */
export declare function parseXml(source: string): XmlElement;
/** The first child with this local name. */
export declare function childOf(element: XmlElement, name: string): XmlElement | undefined;
/** Most keys one `DeleteObjects` may name — S3's own number. */
export declare const MAX_DELETE_KEYS = 1000;
export interface DeleteAsk {
    readonly quiet: boolean;
    readonly objects: ReadonlyArray<{
        readonly key: string;
        readonly versionId: string | null;
    }>;
}
/** `<Delete><Quiet/><Object><Key/><VersionId/></Object>…</Delete>`. */
export declare function deleteAskOf(root: XmlElement): DeleteAsk;
export interface PartChoice {
    readonly partNumber: number;
    readonly etag: string;
}
/** `<CompleteMultipartUpload><Part><PartNumber/><ETag/></Part>…</CompleteMultipartUpload>`, in the order sent. */
export declare function completeAskOf(root: XmlElement): readonly PartChoice[];

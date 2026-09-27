/**
 * Every query parameter S3 treats as naming a sub-resource.
 *
 * ⚠ `uploads`, `uploadId`, `delete`, `location` and `versioning` are answered; `versionId` is
 *   listed so that a request for one version is refused rather than answered with the only one.
 */
export declare const SUB_RESOURCES: readonly string[];
/** The sub-resource this query names, or null when it names none. */
export declare function subResourceOf(query: URLSearchParams): string | null;
export interface Address {
    /** Empty for the service itself: `ListBuckets`. */
    readonly bucket: string;
    /** Empty for the bucket itself. */
    readonly key: string;
}
/**
 * `/drive/photos/a.jpg` → bucket `drive`, key `photos/a.jpg`; or, virtual-hosted, `Host:
 * drive.s3.example.com` and `/photos/a.jpg` → the same two.
 */
export declare function addressOf(pathname: string, host: string | undefined, virtualHostBase: string | undefined): Address;

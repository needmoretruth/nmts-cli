/** MinIO's port, which is what most S3 tools already have in their examples. */
export declare const DEFAULT_PORT = 9000;
export interface S3Options {
    server?: string | undefined;
    network?: string | undefined;
    /** Which port to listen on. Loopback either way. */
    port?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** Resolves when the caller wants the gateway to stop. Tests pass one; a person presses Ctrl-C. */
    until?: Promise<void>;
}
export declare function s3(options?: S3Options): Promise<number>;

export interface PublicCodeOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Publish it, so other accounts can send to it. Permanent. */
    publish?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function publicCode(options?: PublicCodeOptions): Promise<number>;

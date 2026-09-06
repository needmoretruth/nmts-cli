export interface PaddingOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function padding(wanted: string | undefined, options?: PaddingOptions): Promise<number>;

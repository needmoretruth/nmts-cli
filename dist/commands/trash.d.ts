export interface TrashOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function rm(paths: readonly string[], options?: TrashOptions): Promise<number>;
export declare function restore(paths: readonly string[], options?: TrashOptions): Promise<number>;

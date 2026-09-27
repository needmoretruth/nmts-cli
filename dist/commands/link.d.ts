export interface LinkOptions {
    server?: string | undefined;
    network?: string | undefined;
    hideName?: boolean;
    /** `<n>d`. */
    expires?: string | undefined;
    out?: string | undefined;
    force?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function link(sub: string | undefined, operand: string | undefined, options?: LinkOptions): Promise<number>;

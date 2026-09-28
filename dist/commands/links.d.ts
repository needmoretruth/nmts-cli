export interface LinksOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function links(sub: string | undefined, operand: string | undefined, options?: LinksOptions): Promise<number>;

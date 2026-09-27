export interface HandoverOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** `make`: the recipient — a public code, or the path of their public code file. */
    to?: string | undefined;
    /** `make`: the handover file to write. `open`: the file to save the received file as. */
    out?: string | undefined;
    force?: boolean;
    yes?: boolean;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function handover(sub: string | undefined, operand: string | undefined, options?: HandoverOptions): Promise<number>;

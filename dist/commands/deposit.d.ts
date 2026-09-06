export interface DepositOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function deposit(wanted: string | undefined, options?: DepositOptions): Promise<number>;

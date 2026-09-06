export interface BalanceOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function balance(options?: BalanceOptions): Promise<number>;

export interface WalletUseOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function walletUse(said: string | undefined, options?: WalletUseOptions): Promise<number>;

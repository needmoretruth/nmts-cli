export interface TrialOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
export declare function trial(action: string | undefined, options?: TrialOptions): Promise<number>;

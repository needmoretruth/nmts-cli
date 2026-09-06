export interface ConsentOptions {
    json?: boolean;
    write?: (line: string) => void;
    /** The clock. Injected so a test asserts a real timestamp rather than tolerating any string. */
    now?: () => Date;
    /** `grant wallet` only — see `wallet-grant.ts`. */
    days?: string | undefined;
    until?: string | undefined;
    scope?: string | undefined;
    capWal?: string | undefined;
    capSui?: string | undefined;
}
export declare function consent(action: string | undefined, target: string | undefined, options?: ConsentOptions): number;

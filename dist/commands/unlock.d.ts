export interface UnlockOptions {
    json?: boolean;
    write?: (line: string) => void;
    /** The clock. Injected so a test asserts a real timestamp rather than tolerating any string. */
    now?: () => Date;
    /** Injected in tests: answers the one question. Its presence also stands in for a terminal. */
    readLine?: ((question: string) => Promise<string>) | undefined;
    /** `unlock wallet` only — see `wallet-grant.ts`. */
    days?: string | undefined;
    until?: string | undefined;
    scope?: string | undefined;
    capWal?: string | undefined;
    capSui?: string | undefined;
}
/** `unlock` · `lock` · the list. `action` is already normalised by the caller (`grant` → `unlock`). */
export declare function unlock(action: string | undefined, target: string | undefined, options?: UnlockOptions): Promise<number>;

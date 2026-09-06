export interface ModeOptions {
    json?: boolean;
    write?: (line: string) => void;
    now?: () => Date;
    /** Injected in tests: answers the one question. Its presence also stands in for a terminal. */
    readLine?: ((question: string) => Promise<string>) | undefined;
}
export declare function mode(wanted: string | undefined, target: string | undefined, options?: ModeOptions): Promise<number>;

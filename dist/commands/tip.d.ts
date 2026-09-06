export interface TipOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    yes?: boolean;
    write?: (line: string) => void;
    /** Injected in tests: answers the one confirmation above the dial's end. */
    readLine?: ((question: string) => Promise<string>) | undefined;
    now?: number;
}
export declare function tip(wanted: string | undefined, options?: TipOptions): Promise<number>;

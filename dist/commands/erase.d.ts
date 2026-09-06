export interface EraseOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** Also destroy the treasury's storage under credit-paid files, before erasing them. */
    releaseStorage?: boolean;
    /** Under skip-permissions only: the tier gate's answer, given with a `--reason`. */
    yes?: boolean;
    write?: ((line: string) => void) | undefined;
    /** Injected in tests: answers the one typed line. */
    readLine?: ((question: string) => Promise<string>) | undefined;
}
export declare function erase(paths: readonly string[], options?: EraseOptions): Promise<number>;

/** The sentence the browser's erase dialog asks for — the same words, so the act is one act. */
export declare const CONFIRM_SENTENCE = "I UNDERSTAND THIS IS PERMANENT";
export interface DeleteAccountOptions {
    server?: string | undefined;
    write?: ((line: string) => void) | undefined;
    /** Injected in tests: answers the one typed line. */
    readLine?: ((question: string) => Promise<string>) | undefined;
    /** Under skip-permissions only: the tier gate's answer, given with a `--reason`. */
    yes?: boolean;
}
export declare function deleteAccount(options?: DeleteAccountOptions): Promise<number>;

export interface LoginOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** Store the code in the clear rather than sealed. Behind `unsafe-code-storage`. */
    plain?: boolean | undefined;
    /** Store nothing; print the environment variable to set. Behind `plain-env`. */
    env?: boolean | undefined;
    /** Injected in tests so the terminal is not involved. */
    readCode?: (() => Promise<string>) | undefined;
    /** Injected in tests. Called twice for a new passphrase — the second is the confirmation. */
    readPassphrase?: ((prompt: string) => Promise<string>) | undefined;
    /** Injected in tests so the terminal is not involved. An empty answer means "not now". */
    readApiKey?: (() => Promise<string>) | undefined;
    /** Injected in tests. Answers the question that replaces a key already on this machine. */
    confirmKeyReplace?: (() => Promise<string>) | undefined;
    write?: (line: string) => void;
}
export declare function login(options?: LoginOptions): Promise<number>;

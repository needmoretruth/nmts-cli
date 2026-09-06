export interface DevicesOptions {
    server?: string | undefined;
    json?: boolean;
    /** Sign ONE device out by id, or `all` of them. A high act: the tier gate asks first. */
    signOut?: string | undefined;
    /** The answer the tier gate already took, or the person's own `--yes`. */
    yes?: boolean;
    write?: (line: string) => void;
    /** Injected in tests: answers the one confirmation. */
    readLine?: ((question: string) => Promise<string>) | undefined;
}
export declare function devices(options?: DevicesOptions): Promise<number>;

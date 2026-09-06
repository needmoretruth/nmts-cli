export interface SweepOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** Go ahead and drop them. Without this the run reports and changes nothing. */
    yes?: boolean;
    write?: (line: string) => void;
    /** The instant to measure the thirty days against. Passed in so one run means one moment. */
    now?: number;
}
export declare function sweep(options?: SweepOptions): Promise<number>;

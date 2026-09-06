import { type EpochClock } from "../expiry.ts";
export interface ExpiringOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /**
     * Read the storage network's epoch clock.
     *
     * ⚠ A SEAM, NOT AN OPTION: there is no flag for it and no way to supply one from a command line.
     *   It exists because the alternative is a test that either talks to a real storage network — and
     *   so cannot be run in an epoch change, on a halted chain, or at all offline — or does not
     *   exercise the arithmetic that decides what a person is warned about.
     */
    readClock?: () => Promise<EpochClock | null>;
    /** The instant to measure against. Passed in so one run reports one moment. */
    now?: number;
}
export declare function expiring(options?: ExpiringOptions): Promise<number>;

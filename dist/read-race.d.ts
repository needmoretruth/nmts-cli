/**
 * Asking many aggregators for one object without paying a timeout per dead one (D51, 2026-11-09).
 *
 * ⛔ WHY. The read list became every aggregator in Walrus's operator registry that served the probe
 *    blob (dozens). Asked one after another, a dead first row cost its whole timeout before the second
 *    was asked. Here the first host is asked at once and the next when one fails or after `hedgeMs`
 *    with no answer; the first to send its headers wins, the others are cancelled, and only that one
 *    sends a body. A dead row costs `hedgeMs`, not a minute.
 *
 * ⛔ A HOST THAT DOES NOT ANSWER IS GIVEN UP AFTER `headerTimeoutMs`, so hanging rows cannot fill the
 *    in-flight cap for long. With every row hanging, the whole list is through in about
 *    (rows ÷ cap) × header timeout, and the storage nodes are asked after it (`walrus.ts`).
 */
/** What one host said: the response to read, a 404, or something else. */
export type Reply = {
    response: Response;
} | "not-found" | "failed";
export interface RaceOptions {
    /** Ask the next host as well after this long with no answer. */
    hedgeMs: number;
    /** At most this many hosts waiting at once, hanging ones included. */
    maxInFlight: number;
    /** A host with no headers after this long is given up. */
    headerTimeoutMs: number;
    /** This many 404s and no other answer mean the object is not there. */
    notFoundQuorum: number;
    signal?: AbortSignal | undefined;
}
/**
 * Race `hosts`. `ask` sends the request with the signal it is given and answers with the reply; the
 * first reply carrying a response wins and is handed to `read`, which turns its body into the value.
 * When `read` throws, that host counts as failed and the race goes on with the hosts not yet asked.
 * Null when nobody gave a body (`tried` holds each host's reason).
 */
export declare function raceHosts<T>(hosts: readonly string[], ask: (host: string, signal: AbortSignal) => Promise<Reply>, read: (host: string, response: Response) => Promise<T>, options: RaceOptions): Promise<T | null>;

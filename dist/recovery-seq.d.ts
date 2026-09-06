/** The highest sequence this machine has offered for an account, or 0 when it has offered none. */
export declare function lastOfferedSeq(accountId: string): number;
/**
 * Write down a sequence this machine OFFERED — whether or not the server took it.
 *
 * ⛔ OFFERED, NOT ACCEPTED, AND THAT IS THE POINT. Recording only the accepted ones would make a
 *    refused number the number the next run offers again, and every run after it: the same
 *    refusal for ever. Recording the attempt is what makes a second run get past it.
 */
export declare function rememberOfferedSeq(accountId: string, seq: number): void;

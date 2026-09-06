import type { SignMessage } from "../wallet-sign.ts";
export interface WalletHallOptions {
    server?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** `--name`: be listed under this. `--remove`: go back to a shortened address. */
    name?: string | undefined;
    remove?: boolean;
    /** ⚠ A SEAM, NOT AN OPTION — no flag reaches it. It exists so a test never signs for real. */
    sign?: SignMessage;
}
/** One row of the hall, as this tool needs it. Amounts are base units, exactly as they arrived. */
export interface HallEntry {
    rank: number;
    label: string;
    wal: bigint;
    sui: bigint;
}
export interface Hall {
    developerLabel: string;
    developerAddress: string;
    /** The day the SUI/WAL comparison rate was measured, as the server states it. */
    measuredOn: string;
    entries: HallEntry[];
}
/**
 * The bytes both sides sign and check, spelled once.
 *
 * ⛔ EXPORTED SO A TEST CAN HOLD IT. What makes this right is not that it looks right but that the
 *    server builds the same four lines; a test that rebuilt them from this function would only
 *    prove the function agrees with itself, so the test writes the four lines out by hand.
 */
export declare function hallMessage(address: string, name: string | null, issuedAt: string): string;
export declare function asHall(value: unknown): Hall;
export declare function walletHall(options?: WalletHallOptions): Promise<number>;

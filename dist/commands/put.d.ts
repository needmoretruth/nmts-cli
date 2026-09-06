import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
export interface PutOptions {
    server?: string | undefined;
    network?: string | undefined;
    /** The name it gets in the drive. Defaults to the local file's own name. */
    name?: string | undefined;
    /** Destination folder, as `nmts ls` prints it. The drive root when absent. */
    to?: string | undefined;
    /** Say what it would cost and stop. Nothing is sealed, sent, or charged. */
    dryRun?: boolean;
    /**
     * How much of the file goes into one part, in bytes. Defaults to `DEFAULT_PART_BYTES`.
     *
     * Bigger parts mean fewer reservations, and every reservation counts against the account's
     * daily spending allowance; smaller parts mean less memory and a shorter piece of work to lose
     * when something goes wrong. An exact number, not a menu — a person who knows what their machine
     * can hold should be able to say so.
     */
    partSize?: string | number | undefined;
    /** What THIS run does about a name already in use. Absent = this machine's setting. */
    onCollision?: string | undefined;
    /**
     * Who pays for the storage: `credits` (absent) or `wallet`.
     *
     * ⛔ A VALUE, NOT A FLAG, so that a command line says which money it spends. Everything about the
     *    wallet path — the epochs, the review, the agreement, the signatures — is in `put-wallet.ts`.
     */
    pay?: string | undefined;
    /** `--pay wallet`: how many epochs to buy. Refused with credits, whose term is fixed. */
    epochs?: string | number | undefined;
    /** `--pay wallet`: a held storage resource to use — `fit`, `whole`, or its object id. */
    storage?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
}
/** Who pays, or a refusal for a payer this tool does not know. */
export declare function payerOf(pay: string | undefined): "credits" | "wallet";
/** The two options that only mean something when the wallet pays, refused when it does not. */
export declare function refuseWalletOnlyOptions(options: {
    epochs?: string | number | undefined;
    storage?: string | undefined;
}): void;
/**
 * The folder id `--to` names, or null for the root. Refuses rather than guessing.
 *
 * ⛔ IT IS THE SAME LOOKUP EVERY OTHER COMMAND USES. This had its own walk and its own
 *    `e.deletedAt` test, which meant it would happily accept a folder whose PARENT was in the
 *    trash and put a paid-for upload somewhere the drive does not show (2026-08-23).
 */
export declare function folderIdFor(wanted: string | undefined, entries: readonly ManifestEntry[]): string | null;
export declare function put(target: string | undefined, options?: PutOptions): Promise<number>;

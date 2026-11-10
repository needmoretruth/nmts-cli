import { type ExtendReads } from "../extend-plan.ts";
import type { StorageHints } from "./hints.ts";
/** Where to talk and with what. ⛔ No NMTS key: the user's is not here and none is needed. */
export interface ExtendForInput {
    server: string;
    network: string;
    /** The user's delegation token. It must carry `files_read` and `storage_spend`. */
    token: string;
    /** The address that holds the storage and pays. Every blob must be held by it. */
    payer: string;
}
/** What to extend and how. */
export interface ExtendForAsk {
    /** Item ids. Absent = every file the user's account holds that is not in the trash. */
    items?: readonly string[] | undefined;
    /** Epochs to add to each file. Default `DEFAULT_EXTEND_EPOCHS`. */
    epochs?: string | number | undefined;
    /** Extend files that are not near their end yet too. Without it they are skipped as not due. */
    force?: boolean | undefined;
    /** Price every file and sign nothing. */
    dryRun?: boolean | undefined;
}
/** The chain and the signature. ⚠ Seams, not options. */
export interface ExtendForSeams {
    readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
    /** Signs one file's extension from the paying wallet and answers the transaction digest. */
    sign?: ((input: {
        objectIds: readonly string[];
        epochs: number;
    }) => Promise<string>) | undefined;
    /** Told the instant a file's signature exists, before the server is asked to write it down. */
    onSigned?: ((itemId: string, digest: string) => void) | undefined;
    now: number;
    hints?: StorageHints | undefined;
}
/** What happened to one file. */
export interface ExtendForFile {
    itemId: string;
    /** `extended` = signed and paid; `priced` = a dry run's price; `skipped` = nothing signed. */
    outcome: "extended" | "priced" | "skipped";
    /** Why it was skipped, as a code a program can match (`EXTEND_NOT_DUE`, `EXTEND_NOT_OWNED`, …). */
    code: string | null;
    /** Why, in words. Null when nothing needs saying. */
    reason: string | null;
    epochs: number | null;
    /** The blobs' sizes added up — what a ledger that sells size × time charges by. */
    bytes: number | null;
    /** The chain's end of the soonest blob before, and after this extension. */
    endEpoch: number | null;
    newEndEpoch: number | null;
    /** Price in FROST and the fee measured in MIST, as strings. */
    wal: string | null;
    sui: string | null;
    digest: string | null;
}
/** The whole run. */
export interface ExtendForResult {
    dryRun: boolean;
    /**
     * The paying wallet as the first plan read it, in FROST and MIST as decimal strings — the units of
     * every amount here. ⛔ NULL IS NOT ZERO: the chain would not say, or no file was priced.
     */
    wallet: {
        address: string;
        wal: string | null;
        sui: string | null;
    };
    files: ExtendForFile[];
    /** What the extended (or, on a dry run, priced) files cost together, in FROST and MIST. */
    wal: string;
    sui: string;
    /** Why the run stopped before the end, or null when it reached every file. */
    stopped: {
        code: string;
        reason: string;
    } | null;
}
/**
 * Extend a user's files from the paying wallet. Files not due, held by another wallet, already at the
 * network's ceiling or past their end are skipped and said so; the rest are bought one by one.
 *
 * ⛔ THIS SIGNS unless `dryRun` is set, and nothing it buys comes back.
 */
export declare function extendFor(input: ExtendForInput, ask: ExtendForAsk, seams: ExtendForSeams): Promise<ExtendForResult>;

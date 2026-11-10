import { type BuiltRecoveryList } from "./recovery-build.ts";
/** An account as the recovery doors need it. */
export interface RecoveryAccount {
    readonly server: string;
    /** What the one auth header carries: an API key or a delegation token. */
    readonly bearer: string;
    readonly code: string;
    readonly accountId: string;
    readonly network: string;
    /** ⛔ base64url of the code's proof. Held for this call's requests and nothing else. */
    readonly accountProof: string;
}
/** The storage-network copy's switch, whether a copy exists, and the list number to beat. */
export interface RecoveryCopyState {
    enabled: boolean;
    written: boolean;
    seq: number;
}
/**
 * The switch as the server holds it, or null from a server older than the narrow read.
 *
 * ⚠ NULL ONLY FOR 404 AND 405 — "this server has no such door". Any other refusal is thrown: a
 *   copy switched on and a read that failed are opposite facts, and folding one into the other
 *   would quietly stop uploads carrying the list.
 */
export declare function readRecoveryCopy(account: Pick<RecoveryAccount, "server" | "bearer">): Promise<RecoveryCopyState | null>;
/** Turn the storage-network copy on or off. The code's proof travels with it. */
export declare function setRecoveryCopy(account: RecoveryAccount, on: boolean): Promise<void>;
/**
 * The number the next list carries: one past the higher of the server's and this machine's own.
 *
 * ⛔ BOTH, NOT EITHER. The server's alone repeats a number whose record was swallowed; this
 *    machine's alone repeats one a browser already wrote (`recovery-seq.ts`).
 */
export declare function nextRecoverySeq(account: Pick<RecoveryAccount, "server" | "bearer" | "accountId">): Promise<number>;
/** A file going up in the very quilt this list rides in, before the server has heard of it. */
export interface RidingFile {
    /** Its patch's name in the quilt. The list's own-quilt placement points at it. */
    identifier: string;
    name: string;
    parentId: string | null;
    /** The file's real size. */
    size: number;
    /** What its sealed stream declares, which is more than `size` when the stream was padded. */
    streamPlaintextLen: number;
    dekWrapped: string;
    contentHashCt: string;
}
export interface MakeOptions {
    /** Ticks while the account is being read, so a large one does not look frozen. */
    onProgress?: ((loaded: number) => void) | undefined;
    /** Files riding in the quilt this list goes into. */
    riding?: readonly RidingFile[] | undefined;
}
export interface MadeRecoveryList {
    /** The `.nmtsmap` file: the name to offer it under, and its bytes. */
    file: {
        filename: string;
        content: Uint8Array;
    };
    built: BuiltRecoveryList;
    seq: number;
    /** RFC3339, stamped before the account was read. What the server is told. */
    capturedAt: string;
}
/**
 * Read the account, build its recovery list, seal it, and wrap it as the `.nmtsmap` file.
 *
 * ⛔ THE CAPTURE TIME IS STAMPED BEFORE ANYTHING IS READ. The server keeps it to decide which files
 *    count as "not in your list yet"; stamped after the walk, a file made during the walk would be
 *    in neither the list nor the count.
 *
 * ⛔ THE DATA KEY IS DERIVED HERE AND WIPED HERE, on every path out, including the failing one.
 */
export declare function makeRecoveryList(account: RecoveryAccount, options?: MakeOptions): Promise<MadeRecoveryList>;
/**
 * Tell the server a list was written, and what number it carries.
 *
 * ⛔ THE ATTEMPT IS REMEMBERED WHETHER OR NOT IT LANDS (`recovery-seq.ts`): a number the server
 *    refused must not be the number the next run offers again.
 *
 * ⛔ A BLOB ID ONLY FOR A STORAGE-NETWORK COPY. Without one the record says `local`, and the server
 *    refuses an address beside `local` — a recorded address nothing was written to would let a
 *    screen advertise a copy that does not exist.
 */
export declare function recordRecoveryList(account: RecoveryAccount, record: {
    seq: number;
    capturedAt?: string | undefined;
    blobId?: string | undefined;
}): Promise<void>;
/** Note a number as offered before the bytes carrying it leave — skipping one is harmless, reusing one is not. */
export declare function noteOfferedSeq(accountId: string, seq: number): Promise<void>;

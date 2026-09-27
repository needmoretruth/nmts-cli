import type { PlaintextSink } from "../download-sink.ts";
import type { Network } from "../network.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ReadOptions } from "../walrus.ts";
import type { DriveSource, WriteMeta } from "./contract.ts";
import { type KeyLocks } from "./drive-lock.ts";
import type { DriveObject } from "./listing.ts";
import { type StagingStore } from "./staging.ts";
export { placeOf } from "./drive-write.ts";
/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts. Every write reads the list fresh, past this cache.
 */
export declare const LIST_CACHE_MS = 5000;
/** What `store` may answer: the id of the file it stored, so the tag answered is that file's. */
export interface StoredFile {
    readonly id?: string | undefined;
}
/**
 * Where a drive comes from, for whoever is running the gateway.
 *
 * ⛔ A HANDFUL OF FUNCTIONS AND NO CREDENTIAL. The command-line tool holds an open session; the SDK
 *    holds a client whose key may be in a business's sealed store and is borrowed one call at a
 *    time. Nothing in this file may care which, so nothing in this file is handed a key --
 *    `withCode` borrows one for the length of a comparison and the caller decides what that costs.
 */
export interface DriveAccount {
    /** The account's file list, read fresh from the server. Empty for an account that has none. */
    readList(): Promise<readonly ManifestEntry[]>;
    /**
     * Borrow the account's code for the length of `use`.
     *
     * ⚠ ASKED FOR ONE THING ONLY: opening the hash this drive recorded for a file already at the key,
     *   which is sealed under the account's own data key and cannot be compared without it.
     */
    withCode<T>(use: (code: string) => Promise<T>): Promise<T>;
    /** Make this folder path, and any folder above it that is missing. */
    makeFolder(path: string): Promise<void>;
    /**
     * Store one local file under `name`, in `folder` — the top of the account when undefined — and
     * answer the stored file's id when it can (see `StoredFile`).
     *
     * `how.replace` true: a file already at that name goes to the trash (the upload path's
     * "overwrite" rule). False: the upload path's "rename" rule. `how.meta` is what the client sent.
     */
    store(local: string, name: string, folder: string | undefined, how: {
        readonly replace: boolean;
        readonly meta: WriteMeta;
    }): Promise<StoredFile | void>;
    /** Send one path — with its leading slash — to the trash, where it stays for thirty days. */
    trash(path: string): Promise<void>;
    /** Send several paths to the trash in one write to the file list. Absent: one `trash` each. */
    trashMany?(paths: readonly string[]): Promise<void>;
    /**
     * Rename, inside the trash, whatever there holds `name` in `folder`, so a new file can take the
     * name (`drive-trashed-name.ts`). Absent: the upload path numbers the new file instead, and the
     * gateway answers that it landed under another name.
     */
    freeTrashedName?(folder: string | undefined, name: string): Promise<void>;
    /** Fetch, decrypt and deliver one file into the sink. `fetchObject` below is how both do it. */
    fetch(object: DriveObject, sink: PlaintextSink): Promise<void>;
}
export interface DriveSourceOptions {
    readonly account: DriveAccount;
    /**
     * Where the pieces of a multipart upload, and each upload's body, wait until they are stored.
     *
     * ⛔ 0700, AND MADE WHEN IT IS FIRST NEEDED. Pieces are somebody's plaintext; leaving them in a
     *    shared temporary directory under a predictable name would put them where any other account
     *    on the machine could read them, for as long as the upload takes and afterwards.
     */
    readonly stagingRoot: string;
    /**
     * False makes this drive read only, and that is a refusal rather than a gap — the gateway
     * answers every write with the sentence naming what would allow it.
     */
    readonly writable: boolean;
    /**
     * The gateway's multipart staging, shared by every drive it builds. Absent: one of this drive's
     * own, under `stagingRoot`.
     *
     * ⛔ SHARED, NOT CARRIED. An upload in pieces outlives the drive it began under — a gateway
     *    re-asking whose a bucket is builds a new one — and the staging is where it lives meanwhile.
     *    What finishes it is the drive the bucket has when the finish arrives (`staging.ts`).
     */
    readonly staging?: StagingStore | undefined;
    /** The bucket this drive answers to, which is what an upload in the shared staging is filed under. */
    readonly bucket?: string | undefined;
    /**
     * Which account this drive is — its id. An upload begun under another account is not this
     * drive's to finish. Absent: the account behind the bucket never changes.
     */
    readonly owner?: (() => Promise<string>) | undefined;
    /** The gateway's per-key locks, shared by every drive it builds. Absent: this drive's own. */
    readonly locks?: KeyLocks | undefined;
    /** The most bytes one object may have. Absent: no limit but the upload path's own. */
    readonly maxObjectBytes?: number | undefined;
    /** How long a file list may be reused. `LIST_CACHE_MS` unless a caller has a reason. */
    readonly listCacheMs?: number | undefined;
    /**
     * What a write onto a key holding DIFFERENT bytes does. `refuse` unless a caller says otherwise.
     *
     * `refuse` answers 409 and stores nothing: the drive keeps what it has, and a person deletes it
     * first if they mean to replace it. `replace` stores the new bytes and sends the old file to the
     * trash, where it stays recoverable for thirty days — which is what every S3 client expects a PUT
     * to do. Identical bytes are `unchanged` either way, and nothing is sent.
     */
    readonly overwrite?: "replace" | "refuse" | undefined;
    /**
     * Told the key when it already held exactly these bytes, so nothing was sent.
     *
     * ⭐ NOT AN ERROR. An unchanged file costs nothing to re-offer, which is what stops a backup that
     *    runs nightly paying for the nights nothing changed. The words a person reads are the
     *    caller's — this file has no terminal.
     */
    readonly onAlreadyStored?: ((key: string) => void) | undefined;
}
/** Everything `fetchObject` needs to open one file: where to ask, and whose key opens it. */
export interface ObjectReader {
    readonly server: string;
    /**
     * What goes in the one header the server reads: an API key, or a delegation token.
     *
     * ⛔ NAMED FOR WHAT IT IS RATHER THAN FOR ONE OF THE TWO. A field called `apiKey` carrying a
     *    delegation token is how a reader comes to believe a delegated client cannot do something it
     *    can.
     */
    readonly bearer: string;
    readonly code: string;
    readonly chain: Network;
    /** Hosts to read stored bytes from, instead of the network's own aggregators. */
    readonly read?: ReadOptions | undefined;
}
/** The real reader: the stored bytes, opened with this account's key and delivered to the sink. */
export declare function fetchObject(reader: ObjectReader, object: DriveObject, sink: PlaintextSink): Promise<void>;
/** One account as the protocol layer sees it: a cached list, a reader, and a writer when allowed. */
export declare function createDriveSource(options: DriveSourceOptions): DriveSource;

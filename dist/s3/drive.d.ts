import type { PlaintextSink } from "../download-sink.ts";
import type { Network } from "../network.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { ReadOptions } from "../walrus.ts";
import type { DriveObject } from "./listing.ts";
import type { DriveSource } from "./server.ts";
import { type Staging } from "./staging.ts";
/**
 * How long a file list may be reused before it is fetched again.
 *
 * ⛔ THERE IS A CACHE BECAUSE A SYNC IS THOUSANDS OF REQUESTS. Reading the list per request would
 *    mean a server round trip and a decryption for each one, so a listing of a large drive would
 *    take minutes and cost the account's rate budget. ⚠ It also means a file uploaded from another
 *    device can be up to this long in appearing here, which is the trade and is written in the
 *    tool's own words when it starts.
 */
export declare const LIST_CACHE_MS = 5000;
/**
 * Where a drive comes from, for whoever is running the gateway.
 *
 * ⛔ SIX FUNCTIONS AND NO CREDENTIAL. The command-line tool holds an open session; the SDK holds a
 *    client whose key may be in a business's sealed store and is borrowed one call at a time.
 *    Nothing in this file may care which, so nothing in this file is handed a key -- `withCode`
 *    borrows one for the length of a comparison and the caller decides what that costs.
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
    /** Store one local file under `name`, in `folder` — the top of the account when undefined. */
    store(local: string, name: string, folder: string | undefined): Promise<void>;
    /** Send one path — with its leading slash — to the trash, where it stays for thirty days. */
    trash(path: string): Promise<void>;
    /** Fetch, decrypt and deliver one file into the sink. `fetchObject` below is how both do it. */
    fetch(object: DriveObject, sink: PlaintextSink): Promise<void>;
}
export interface DriveSourceOptions {
    readonly account: DriveAccount;
    /**
     * Where the pieces of a multipart upload wait until they are one file.
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
     * The staging an earlier source for the same bucket was using, when there was one.
     *
     * ⛔ AN UPLOAD IN PIECES OUTLIVES THE SOURCE IT BEGAN UNDER. A caller that rebuilds its sources —
     *    a gateway re-asking whose bucket this is — would otherwise hand the next piece to a staging
     *    that has never heard of the upload, and a large file could never finish.
     */
    readonly multipart?: Staging | undefined;
    /** How long a file list may be reused. `LIST_CACHE_MS` unless a caller has a reason. */
    readonly listCacheMs?: number | undefined;
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
/**
 * `photos/2026/a.jpg` → the folder to make and the name to store under.
 *
 * A key with no slash lands at the top of the account, which is `undefined` rather than `""`: the
 * two mean the same thing to a person and different things to the upload path.
 */
export declare function placeOf(key: string): {
    folder: string | undefined;
    name: string;
};
/** The real reader: the stored bytes, opened with this account's key and delivered to the sink. */
export declare function fetchObject(reader: ObjectReader, object: DriveObject, sink: PlaintextSink): Promise<void>;
/** One account as the protocol layer sees it: a cached list, a reader, and a writer when allowed. */
export declare function createDriveSource(options: DriveSourceOptions): DriveSource;

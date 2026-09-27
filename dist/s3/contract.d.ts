import type { PlaintextSink } from "../download-sink.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import type { DecodedBody } from "./body.ts";
import type { WriteCondition } from "./drive-conditions.ts";
import type { DriveObject } from "./listing.ts";
import type { GatewayCredential } from "./sigv4.ts";
import type { Staging } from "./staging.ts";
/**
 * What a client said about an object it is writing, beyond its bytes.
 *
 * ⚠ HANDED ON, NOT KEPT. The file list holds a name, a size and two times; this is what the client
 *   sent, passed to whoever stores the file so that it can act on it (a storage class, say). A GET
 *   later answers a type guessed from the key's extension, not this one.
 */
export interface WriteMeta {
    /** `x-amz-storage-class`, trimmed and upper-cased. Null when the client sent none. */
    readonly storageClass: string | null;
    /** `Content-Type` as the client sent it. Null when absent. */
    readonly contentType: string | null;
}
/** What storing a file at a key came to. */
export interface StoreOutcome {
    /** The tag a HEAD of this key answers afterwards. */
    readonly etag: string;
    /**
     * `stored`: nothing was at the key. `replaced`: the new file is stored and the one that was at
     * the key went to the trash. `unchanged`: exactly these bytes were already there, and nothing
     * was sent.
     */
    readonly outcome: "stored" | "replaced" | "unchanged";
}
/** The file a copy reads from: the drive that holds it, and which of its files. */
export interface CopySource {
    readonly source: DriveSource;
    readonly object: DriveObject;
}
/** What sending one key to the trash came to: null when it went (or was already gone), the failure otherwise. */
export interface RemoveOutcome {
    readonly key: string;
    readonly error: unknown;
}
export interface DriveSource {
    /**
     * The account's live file list. Called per request; the caller decides what to cache.
     *
     * `fresh` asks for the list as the server holds it now, past any cache — what a decision that
     * must not be made on a stale list (a condition, a copy's source) asks for.
     */
    entries(options?: {
        readonly fresh?: boolean;
    }): Promise<readonly ManifestEntry[]>;
    /**
     * Fetch, decrypt and deliver one file into the sink.
     *
     * ⛔ INJECTED RATHER THAN IMPORTED so this server can be driven by a real S3 client in a test
     *    without an account, a network and somebody's credits. A gateway whose only test is an
     *    end-to-end one is a gateway whose refusals are never tested at all.
     */
    fetch(object: DriveObject, sink: PlaintextSink): Promise<void>;
    /**
     * How to change the drive, when this machine has agreed to spending.
     *
     * ⛔ ABSENT MEANS READ ONLY, AND THAT IS A REFUSAL RATHER THAN A GAP. Uploading spends credits,
     *    which is one of the three things this tool asks a person about once per machine, and a
     *    gateway cannot ask: its stdin is not a terminal and the caller is a program. So the
     *    agreement has to exist beforehand, and where it does not, every write says so.
     */
    readonly write?: DriveWriter;
}
export interface DriveWriter {
    /**
     * Store a request body at this key.
     *
     * ⛔ NOTHING IS STORED UNTIL `body.verified` RESOLVES. The bytes may be spooled as they arrive,
     *    but a digest, a chunk signature or a checksum is only known once the last byte is in, and a
     *    body that fails one must not become somebody's file.
     */
    put(key: string, body: DecodedBody, meta: WriteMeta, condition?: WriteCondition): Promise<StoreOutcome>;
    /** Store a copy of a file this gateway can already read — in this drive or another — at this key. */
    copy(from: CopySource, key: string, meta: WriteMeta, condition?: WriteCondition): Promise<StoreOutcome>;
    /**
     * Send what is at these keys to the trash, where it stays recoverable for thirty days, in as few
     * writes to the file list as the drive allows. Each key is answered on its own; a key that holds
     * nothing — never did, or is in the trash already — is answered as gone, which is S3's answer.
     */
    remove(keys: readonly string[], condition?: WriteCondition): Promise<readonly RemoveOutcome[]>;
    /**
     * Staging for uploads that arrive in pieces. Absent means this gateway refuses them.
     *
     * ⚠ Separate from `put` because the pieces have to land somewhere before they are one file, and
     *   where that is belongs to whoever is running this rather than to the protocol.
     */
    readonly multipart?: Staging;
    /** The most bytes one object may have here. Absent: no limit but the upload path's own. */
    readonly maxObjectBytes?: number | undefined;
}
export interface GatewayOptions {
    /**
     * Every pair that may sign a request here, each optionally held to named buckets.
     *
     * ⛔ A LIST RATHER THAN ONE PAIR BECAUSE A BUCKET IS AN ACCOUNT. `nmts s3` makes one pair for one
     *    drive; a business serving many of its users' accounts hands each of them a pair of their
     *    own, and the restriction on the pair is what stops one customer reading another's bucket.
     */
    readonly credentials: readonly GatewayCredential[];
    /**
     * Which drive answers to this bucket name, or null when none does.
     *
     * ⛔ THE GATEWAY DOES NOT KNOW WHAT A BUCKET IS. It was one name and one drive for as long as the
     *    only caller was the command-line tool; asked by a business's server it is a lookup that
     *    server does, and one it may do differently per name. What must not change is that a name
     *    this resolver refuses looks exactly like a name the caller may not touch (see below).
     */
    readonly bucketOf: (name: string) => DriveSource | null | Promise<DriveSource | null>;
    /**
     * The names `ListBuckets` answers with, before the signing pair's own restriction is applied.
     *
     * ⚠ ABSENT IS A REAL ANSWER RATHER THAN A GAP. A gateway in front of a business's own lookup
     *   cannot enumerate its customers, so what it can honestly name is what the presented pair is
     *   held to — and an unrestricted pair on such a gateway is told nothing, which is true.
     */
    readonly bucketNames?: () => readonly string[] | Promise<readonly string[]>;
    /**
     * The host that virtual-hosted requests are addressed under, such as `s3.example.com`.
     *
     * When set, a request whose `Host` is `<bucket>.s3.example.com` (any port) names its bucket in
     * the host and its key in the whole path — the form the AWS SDKs use unless told otherwise.
     * Every other request is path style, `/<bucket>/<key>`, which is all there is when this is absent.
     */
    readonly virtualHostBase?: string | undefined;
    /**
     * Called with one line whenever a request is answered, so a person can watch what a tool does.
     *
     * ⛔ THE LINE NAMES THE OPERATION AND THE STATUS, NEVER A KEY OR A PREFIX. A key is a file's
     *    path, and a path is a file name — the thing this product keeps from the server it stores on.
     */
    readonly log?: (line: string) => void;
    /** Passed in so a test can hold the clock still. */
    readonly now?: () => number;
    /**
     * How long `CompleteMultipartUpload`, `CopyObject` and `DeleteObjects` may work before their 200
     * begins — work that ends sooner is answered with its own status — and then how often a space is
     * written until it ends. `KEEP_ALIVE_MS` (10 seconds) unless a test needs it shorter.
     */
    readonly keepAliveMs?: number | undefined;
    /**
     * The sentence a write gets from a read-only drive. `nmts s3` says what a person runs on this
     * machine to allow spending; a gateway somebody else runs has a different way in, and says its own.
     */
    readonly readOnlyBecause?: string | undefined;
    /**
     * How many writes — uploads, parts, finishes, copies, deletes — run at once. One past it is
     * answered 503 `SlowDown` with `Retry-After`, which every S3 client waits on and sends again.
     * `MAX_CONCURRENT_WRITES` (16) unless a caller says.
     */
    readonly maxConcurrentWrites?: number | undefined;
}

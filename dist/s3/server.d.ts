import { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import type { PlaintextSink } from "../download-sink.ts";
import type { ManifestEntry } from "../shared/lib/drive/manifest-codec.ts";
import { type DriveObject } from "./listing.ts";
import { type GatewayCredential } from "./sigv4.ts";
/** Where the drive is served. Loopback, always — see the note above. */
export declare const BIND_ADDRESS = "127.0.0.1";
export interface DriveSource {
    /** The account's live file list. Called per request; the caller decides what to cache. */
    entries(): Promise<readonly ManifestEntry[]>;
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
    /** Store `body` at this key. `size` is the byte count the client declared. */
    put(key: string, body: Readable, size: number): Promise<void>;
    /** Send one file to the trash, where it stays recoverable for thirty days. */
    trash(object: DriveObject): Promise<void>;
    /**
     * Staging for uploads that arrive in pieces. Absent means this gateway refuses them.
     *
     * ⚠ Separate from `put` because the pieces have to land somewhere before they are one file, and
     *   where that is belongs to whoever is running this rather than to the protocol.
     */
    readonly multipart?: {
        begin(key: string): Promise<string>;
        part(uploadId: string, partNumber: number, body: Readable, size: number, expectedSha256: string | null): Promise<string>;
        complete(uploadId: string): Promise<string>;
        abort(uploadId: string): Promise<void>;
    };
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
    /** Called with one line whenever a request is answered, so a person can watch what a tool does. */
    readonly log?: (line: string) => void;
    /** Passed in so a test can hold the clock still. */
    readonly now?: () => number;
    /**
     * The sentence a write gets from a read-only drive. `nmts s3` says what a person runs on this
     * machine to allow spending; a gateway somebody else runs has a different way in, and says its own.
     */
    readonly readOnlyBecause?: string | undefined;
}
/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export declare function newCredential(): GatewayCredential;
/** A plain Node request handler, so this can be mounted in somebody else's server. */
export type GatewayHandler = (req: IncomingMessage, res: ServerResponse) => void;
/**
 * The gateway as a handler, which is the form that listens to nothing.
 *
 * ⛔ SEPARATE FROM `createGateway` BECAUSE WHO LISTENS IS NOT THIS FILE'S DECISION. The
 *    command-line tool binds loopback and says why at the top of this file; a business mounting
 *    this behind its own TLS has already made that decision, and a library that opened a socket of
 *    its own would be making it again, differently.
 */
export declare function gatewayHandler(options: GatewayOptions): GatewayHandler;
export declare function createGateway(options: GatewayOptions): Server;

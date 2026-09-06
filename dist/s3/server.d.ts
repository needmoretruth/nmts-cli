import { type Server } from "node:http";
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
    readonly credential: GatewayCredential;
    readonly source: DriveSource;
    /** Called with one line whenever a request is answered, so a person can watch what a tool does. */
    readonly log?: (line: string) => void;
    /** Passed in so a test can hold the clock still. */
    readonly now?: () => number;
}
/** A random pair, made fresh every time the gateway starts and stored nowhere. */
export declare function newCredential(): GatewayCredential;
export declare function createGateway(options: GatewayOptions): Server;

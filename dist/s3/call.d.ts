import type { IncomingMessage, ServerResponse } from "node:http";
import type { DriveSource, GatewayOptions, WriteMeta } from "./contract.ts";
import type { GatewayCredential, VerifiedAgainst } from "./sigv4.ts";
export interface Call {
    readonly req: IncomingMessage;
    readonly res: ServerResponse;
    readonly method: string;
    readonly query: URLSearchParams;
    readonly bucket: string;
    readonly key: string;
    /** The path as it arrived, which is what an error document names as its resource. */
    readonly resource: string;
    readonly verdict: Extract<VerifiedAgainst, {
        ok: true;
    }>;
    readonly options: GatewayOptions;
    readonly source: DriveSource;
}
/**
 * What a caller signed with a pair it may not use here.
 *
 * ⛔ THE SAME ANSWER WHETHER OR NOT THE BUCKET EXISTS, which is why the restriction is checked
 *    before the resolver is asked. Answering `NoSuchBucket` for a name the caller may not touch
 *    would turn this gateway into a way of asking "does this business have a customer called…",
 *    one guess at a time.
 */
export declare const NOT_YOURS = "That access key may not use that bucket.";
/** Whether the pair that signed is allowed anywhere near this bucket name. */
export declare function mayTouch(credential: GatewayCredential, bucket: string): boolean;
export declare function headerOf(req: IncomingMessage, name: string): string | undefined;
/** What the client said about the object it is writing, as the drive is handed it. */
export declare function metaOf(req: IncomingMessage): WriteMeta;
/** The one sentence a write gets from `nmts s3` when this machine has not agreed to spending. */
export declare function readOnlyOnThisMachine(): string;
/** Why this drive takes no writes, in the words of whoever runs the gateway. */
export declare function readOnlyBecause(options: GatewayOptions): string;

import type { ServerResponse } from "node:http";
import type { PlaintextSink } from "../download-sink.ts";
export interface ResponseSinkOptions {
    /** Headers to send with the 200 or 206, once the size is known. */
    readonly headers: Readonly<Record<string, string>>;
    /** Only these bytes, inclusive, answered 206. Null or absent answers the whole file. */
    readonly window?: {
        readonly start: number;
        readonly end: number;
    } | null | undefined;
}
/** A response sink, and whether a range it was cutting has been delivered in full. */
export interface ResponseSink extends PlaintextSink {
    /** True once every byte of the window went out and the response was ended. */
    windowDelivered(): boolean;
}
/** A sink that writes one file into an HTTP response and never leaves a short body looking whole. */
export declare function responseSink(res: ServerResponse, options: ResponseSinkOptions): ResponseSink;

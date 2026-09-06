import type { ServerResponse } from "node:http";
import type { PlaintextSink } from "../download-sink.ts";
export interface ResponseSinkOptions {
    /** Headers to send with the 200, once the size is known. */
    readonly headers: Readonly<Record<string, string>>;
}
/** A sink that writes one file into an HTTP response and never leaves a short body looking whole. */
export declare function responseSink(res: ServerResponse, options: ResponseSinkOptions): PlaintextSink;

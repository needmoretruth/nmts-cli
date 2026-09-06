import type { IncomingMessage, ServerResponse } from "node:http";
import type { DriveWriter } from "./server.ts";
/** S3's own ceiling, and a bound on what one client can stage on this machine. */
export declare const MAX_PARTS = 10000;
export interface MultipartContext {
    readonly req: IncomingMessage;
    readonly res: ServerResponse;
    readonly bucket: string;
    readonly key: string;
    readonly method: string;
    readonly query: URLSearchParams;
    readonly writer: DriveWriter;
    /** The declared payload hash from the signature, when it was a real digest. */
    readonly payloadHash: string | null;
    readonly fail: (status: number, code: string, message: string) => void;
    readonly log?: ((line: string) => void) | undefined;
}
/** True when this request belongs to a multipart upload rather than a plain object call. */
export declare function isMultipartRequest(method: string, query: URLSearchParams): boolean;
/** Answer one multipart request. Returns false when the shape is not one this gateway knows. */
export declare function handleMultipart(context: MultipartContext): Promise<boolean>;

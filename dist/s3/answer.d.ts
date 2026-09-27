import type { ServerResponse } from "node:http";
/** A refusal this gateway decided on, carrying the S3 status and code it is answered with. */
export declare class S3Refusal extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
/** One failure, as the error document and headers an S3 client reads. */
export interface S3Answer {
    readonly status: number;
    readonly code: string;
    readonly message: string;
    /** Seconds a client should wait before sending it again, when anything said. */
    readonly retryAfter: number | null;
    /**
     * What the client was not told: the failure's own code or name and its own words, for whoever
     * runs the gateway. Null when `message` already says everything there is.
     */
    readonly reason: string | null;
}
/**
 * How long a client is asked to wait after the storage network did not take the bytes, when nothing
 * named a wait. The storage is paid for and the bytes are kept, so the retry costs only the push.
 */
export declare const PUSH_RETRY_AFTER_SECONDS = 5;
/** What an S3 client should be told about a thrown value. */
export declare function answerFor(error: unknown): S3Answer;
/**
 * Why this response failed, for whoever runs the gateway: undefined when it did not, or when its
 * client was told everything there was.
 *
 * ⛔ NEVER A KEY. The request's path, and each of its segments, is taken out of the reason, since a
 *    failure's words may quote the file it was about and the log never names a file.
 */
export declare function failureReasonOf(res: ServerResponse): string | undefined;
/** Keep why this response failed, when its client was told less than that. */
export declare function noteFailure(res: ServerResponse, answer: S3Answer, resource: string): void;
/** Answer with an XML body, or with its headers alone for a HEAD. */
export declare function sendXml(res: ServerResponse, status: number, body: string, extra?: Record<string, string>): void;
/** Answer one refusal as the error document S3 sends. */
export declare function refuse(res: ServerResponse, status: number, code: string, message: string, resource: string, extra?: Record<string, string>): void;
/**
 * Answer whatever was thrown, if the response can still carry an answer.
 *
 * ⛔ A RESPONSE THAT HAS BEGUN IS DESTROYED, NOT ENDED. Its status and length went out already; a
 *    clean end after a short body is what every client files away as a whole file.
 */
export declare function failWith(res: ServerResponse, error: unknown, resource: string): void;

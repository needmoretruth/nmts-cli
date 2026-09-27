import type { IncomingMessage } from "node:http";
export type RangeAsk = {
    readonly kind: "whole";
} | {
    readonly kind: "window";
    readonly start: number;
    readonly end: number;
} | {
    readonly kind: "unsatisfiable";
};
/** What a `Range` header asks of an object this many bytes long. */
export declare function rangeOf(header: string | undefined, size: number): RangeAsk;
/** What the conditional headers of a GET or HEAD come to for this object. */
export declare function preconditionOf(req: IncomingMessage, etag: string, updatedAt: number): 200 | 304 | 412;

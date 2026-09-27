/** The request function this module needs: `fetch`, or anything shaped like it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/**
 * How the part's bytes are sent in step 2. The default is `fetch`, which cannot report how much of
 * a request body has gone out; a browser passes one built on XMLHttpRequest, which can.
 */
export type PutBody = (input: {
    url: string;
    body: Blob | Uint8Array<ArrayBuffer>;
    signal?: AbortSignal;
    onProgress?: (sentBytes: number, totalBytes: number) => void;
}) => Promise<Response>;
/** Why an upload did not complete, as a machine-readable word. */
export type PieceUploadFailure = "not_https" | "size_out_of_range" | "session_refused" | "location_missing" | "upload_refused" | "finalize_refused";
export declare class PieceUploadError extends Error {
    readonly reason: PieceUploadFailure;
    /** The HTTP status that ended it, when a response was the reason. */
    readonly status: number | null;
    constructor(reason: PieceUploadFailure, message: string, status?: number | null);
}
export interface UploadPieceInput {
    /** The company's service origin, as the order's `target` answered it (`https://…`). */
    serviceUrl: string;
    /** The sealed part, exactly the bytes its PieceCID was computed over. */
    bytes: Blob | Uint8Array<ArrayBuffer>;
    /** The part's PieceCID (`bafkzcib…`). The company refuses the upload if the bytes do not match. */
    pieceCid: string;
    signal?: AbortSignal;
    /** Bytes of the part sent so far, and the part's size. */
    onProgress?: (sentBytes: number, totalBytes: number) => void;
    /** Requests for steps 1 and 3 (and step 2 when `put` is absent). Default: the global `fetch`. */
    fetchImpl?: FetchLike;
    /** Step 2's transport. Default: `fetchImpl`, with progress reported only at the end. */
    put?: PutBody;
}
/** Upload one part and have the company accept it under `pieceCid`. Resolves once step 3 answers 2xx. */
export declare function uploadPieceToProvider(input: UploadPieceInput): Promise<void>;

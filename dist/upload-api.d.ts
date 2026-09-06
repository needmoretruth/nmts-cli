import type { UploadApi } from "./upload-wire.ts";
/** Bind the four calls to one server and one credential. */
export declare function createUploadApi(base: string, apiKey: string): UploadApi;

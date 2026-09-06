import { type Readable } from "node:stream";
/** What the staging does with a finished file: store it in the drive at that key. */
export type StoreFile = (key: string, path: string) => Promise<void>;
export interface Staging {
    begin(key: string): Promise<string>;
    part(uploadId: string, partNumber: number, body: Readable, size: number, expectedSha256: string | null): Promise<string>;
    complete(uploadId: string): Promise<string>;
    abort(uploadId: string): Promise<void>;
}
export declare function createStaging(root: string, store: StoreFile): Staging;

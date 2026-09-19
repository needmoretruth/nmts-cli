import { type PlaintextSource } from "./upload-file.ts";
/** Read a file off the disk, a chunk at a time. */
export declare function fileSource(path: string, size: number): PlaintextSource;

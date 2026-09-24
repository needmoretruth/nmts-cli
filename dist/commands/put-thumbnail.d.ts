import type { PutOptions } from "./put.ts";
type PutOne = (target: string | undefined, options: PutOptions) => Promise<number>;
export declare function putWithThumbnail(target: string | undefined, options: PutOptions, putOne: PutOne): Promise<number>;
export {};
